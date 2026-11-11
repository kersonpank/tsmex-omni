import { linkVehicleInclude, manifestVehicleAssignmentsInclude } from '../vehicleUnitService.js';
import { resolveManifestComposition } from '../vehicleUnitRules.js';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { requireSelectedIbge } from '../selectedCity.js';
import { resolveMatrizCnpj, type EfreteEnvironment } from '../efrete/efreteConfig.js';
import { digits, splitPhone } from '../efrete/efreteUtil.js';
import { hasCompleteFiscalAddress } from '../fiscalInputValidation.js';
import type { CiotMapperInput, CiotRequestData, CiotTipoViagemApi } from '../efrete/efreteCiotMapper.js';

/** Formato persistido em `CiotEmissionJob.requestData` — Carta Frete + campos que só existem no Fracionado. */
export type StoredCiotRequestData = CiotRequestData & { contratantesCargaFracionada?: string[]; matrizCnpj?: string };

const tipoViagemToApi: Record<string, CiotTipoViagemApi> = {
    PADRAO: 'Padrao',
    FRACIONADO: 'Fracionado',
    TAC_AGREGADO: 'TAC_Agregado',
};

export interface BuildCiotEmissionInputDeps {
    prisma?: {
        ciotEmissionJob: { findUniqueOrThrow: (...args: any[]) => Promise<any> };
        manifest: { findUniqueOrThrow: (...args: any[]) => Promise<any> };
        fiscalEmitter: {
            findUnique: (...args: any[]) => Promise<any>;
            findFirst: (...args: any[]) => Promise<any>;
        };
    };
    resolveIbgeMunicipio?: typeof requireSelectedIbge;
}

export async function buildCiotEmissionInputForJob(
    ciotEmissionJobId: string,
    deps: BuildCiotEmissionInputDeps = {},
): Promise<{
    mapperInput: CiotMapperInput;
    environment: EfreteEnvironment;
}> {
    const db = deps.prisma ?? prisma;
    const resolveIbge = deps.resolveIbgeMunicipio ?? requireSelectedIbge;

    const job = await db.ciotEmissionJob.findUniqueOrThrow({ where: { id: ciotEmissionJobId } });
    const requestData = job.requestData as unknown as StoredCiotRequestData;
    const manifest = await db.manifest.findUniqueOrThrow({
        where: { id: job.manifestId },
        include: {
            vehicleAssignments: manifestVehicleAssignmentsInclude,
            hub: { include: { person: true } },
            destHub: { include: { person: true } },
            link: { include: { person: true, ...linkVehicleInclude } },
            driver: { include: { person: true } },
            tripStops: { orderBy: { sequence: 'asc' }, include: { destHub: true } },
        },
    });

    if (!manifest.hub?.person) throw new AppError('Manifesto sem Hub com pessoa (CNPJ) para resolver o Contratante do CIOT.', 400);
    if (!manifest.link) throw new AppError('Manifesto sem Link (transportador) atribuído.', 400);
    const composition = resolveManifestComposition(manifest);
    const contratadoRntrc = digits(manifest.link.rntrc);
    if (!/^\d{8,9}$/.test(contratadoRntrc) || !manifest.link.carrierType) throw new AppError('Complete o RNTRC e o tipo do transportador contratado para emitir o CIOT.', 422);
    if (!manifest.driver) throw new AppError('Manifesto sem motorista definido ("Definir Motorista") — obrigatório para CIOT.', 400);
    if (manifest.driver.active === false) throw new AppError('Motorista inativo. Selecione um motorista ativo.', 400);
    if (!manifest.driver.cnhNumber) throw new AppError('Motorista sem número de CNH cadastrado.', 400);

    let fiscalEmitter: any = null;
    if (manifest.fiscalEmitterId != null) {
        fiscalEmitter = await db.fiscalEmitter.findUnique({
            where: { id: manifest.fiscalEmitterId },
            include: { person: true },
        });
        if (!fiscalEmitter?.person) {
            throw new AppError('FiscalEmitter selecionado no manifesto não encontrado ou sem pessoa (CNPJ).', 400);
        }
    } else {
        fiscalEmitter = await db.fiscalEmitter.findFirst({
            where: { hubId: manifest.hubId ?? undefined, active: true },
            orderBy: [{ defaultForHub: 'desc' }, { updatedAt: 'desc' }],
            include: { person: true },
        });
        if (!fiscalEmitter?.person) {
            throw new AppError('Hub sem FiscalEmitter ativo — obrigatório como Contratante do CIOT.', 400);
        }
    }

    const efreteEnv = job.environment ?? fiscalEmitter.efreteEnvironment ?? 'HOMOLOGACAO';
    const environment: EfreteEnvironment = efreteEnv === 'PRODUCAO' ? 'producao' : 'homologacao';
    const contratanteDoc = digits(fiscalEmitter.person.document);
    if (!/^\d{14}$/.test(contratanteDoc)) throw new AppError('CNPJ do emitente inválido.', 422);
    const emitterAddress = fiscalEmitter.person;
    if (!hasCompleteFiscalAddress(emitterAddress)) throw new AppError('Complete bairro, CEP, rua, número, cidade, UF e IBGE reais do emitente para o CIOT.', 422);
    const matrizCnpj = requestData.matrizCnpj ?? resolveMatrizCnpj(contratanteDoc, environment);

    const origin = manifest.originCity || manifest.originCityIbgeCode
        ? { city: manifest.originCity, state: manifest.originState, code: manifest.originCityIbgeCode }
        : { city: manifest.hub.city, state: manifest.hub.state, code: manifest.hub.cityIbgeCode };
    const origemMunicipio = await resolveIbge(origin.city, origin.state, origin.code);
    const contratanteMunicipio = await resolveIbge(fiscalEmitter.person.city, fiscalEmitter.person.state, fiscalEmitter.person.cityIbgeCode);
    const stops = [...(manifest.tripStops ?? [])].sort((a: any, b: any) => a.sequence - b.sequence);
    const destination = [...stops].reverse().map((stop: any) => ({
        city: stop.destHub?.city ?? stop.destCity,
        state: stop.destHub?.state ?? stop.destState,
        ibge: stop.destHub?.cityIbgeCode ?? stop.destCityIbgeCode,
    })).find((value) => value.city && value.state) ?? {
        city: manifest.destHub?.city ?? manifest.destinationCity,
        state: manifest.destHub?.state ?? manifest.destinationState,
        ibge: manifest.destHub?.cityIbgeCode ?? manifest.destinationCityIbgeCode,
    };
    if (!destination.city || !destination.state) throw new AppError('CIOT sem destino canônico: informe cidade e UF no manifesto ou em uma parada.', 400);
    const destinoMunicipio = await resolveIbge(destination.city, destination.state, destination.ibge);

    const linkDoc = digits(manifest.link.document);
    const driverDoc = digits(manifest.driver.document);
    if (!/^\d{11}$/.test(driverDoc) || !/^\d{11}(\d{3})?$/.test(linkDoc)) throw new AppError('Confira o CPF do motorista e CPF/CNPJ do transportador.', 422);
    const driverPhone = splitPhone(manifest.driver.phone);
    if (!driverPhone) throw new AppError('Motorista sem celular válido (DDD + número) cadastrado.', 400);

    const veiculos = composition.units.map((unit) => unit.plate);

    const tipoViagem = tipoViagemToApi[job.tipoViagem];
    if (tipoViagem === 'TAC_Agregado' && !/^\d{8,9}$/.test(digits(fiscalEmitter.rntrc))) throw new AppError('RNTRC da contratante obrigatório para TAC Agregado.', 422);

    const mapperInput: CiotMapperInput = {
        tipoViagem,
        idOperacaoCliente: job.idOperacaoCliente,
        matrizCnpj,
        contratante: {
            nomeOuRazaoSocial: fiscalEmitter.person.legalName,
            cpfOuCnpj: contratanteDoc,
            endereco: {
                bairro: fiscalEmitter.person.neighborhood,
                cep: digits(fiscalEmitter.person.cep),
                codigoMunicipio: Number(contratanteMunicipio),
                rua: fiscalEmitter.person.address,
                numero: fiscalEmitter.person.number,
                ...(fiscalEmitter.person.complement ? { complemento: fiscalEmitter.person.complement } : {}),
            },
            ...(tipoViagem === 'TAC_Agregado' ? { rntrc: digits(fiscalEmitter.rntrc).padStart(9, '0') } : {}),
        },
        contratado: { cpfOuCnpj: linkDoc, rntrc: contratadoRntrc.padStart(9, '0') },
        motorista: { cpfOuCnpj: driverDoc, cnh: manifest.driver.cnhNumber, celular: { ddd: driverPhone.ddd, numero: driverPhone.numero } },
        codigoMunicipioOrigem: Number(origemMunicipio),
        codigoMunicipioDestino: Number(destinoMunicipio),
        veiculos,
        ...(tipoViagem === 'Fracionado' ? { contratantesCargaFracionada: requestData.contratantesCargaFracionada ?? [] } : {}),
        requestData,
    };

    return { mapperInput, environment };
}
