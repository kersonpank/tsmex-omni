import { ensureEfreteIntegratorPerson } from '../efrete/ensureEfreteIntegratorPerson.js';
import { linkVehicleInclude, manifestVehicleAssignmentsInclude } from '../vehicleUnitService.js';
import { resolveManifestComposition, tractionRntrc } from '../vehicleUnitRules.js';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { requireSelectedIbge } from '../selectedCity.js';
import { manifestRouteCities } from '../manifestAnttSuggestion.js';
import { resolveCiotContratante, resolveMatrizCnpj, type EfreteEnvironment } from '../efrete/efreteConfig.js';
import { digits, normalizeEfreteRntrc, normalizeEfreteAddressNumber, normalizeEfreteCep, splitPhone } from '../efrete/efreteUtil.js';
import type { CiotMapperInput, CiotRequestData, CiotTipoViagemApi } from '../efrete/efreteCiotMapper.js';

/** Formato persistido em `CiotEmissionJob.requestData` — Carta Frete + campos que só existem no Fracionado. */
export type StoredCiotRequestData = CiotRequestData & { contratantesCargaFracionada?: string[] };

/** Mesma extração no preflight da rota e no worker. */
export function ciotNotasFiscaisFromLegs(legs: Array<{ order?: { demand?: {
    nfNumber?: string | null; nfValue?: number | null; weight?: number | null; rawInputData?: unknown;
} } }> = [], tacAgregado = false): CiotMapperInput['notasFiscais'] {
    if (tacAgregado) return [];
    const notas = legs.flatMap(({ order }) => {
        const demand = order?.demand;
        if (!demand?.nfNumber?.trim()) return [];
        const raw = demand.rawInputData as { nfeXmlData?: { chave?: string; serie?: string | number; emitente?: { cnpj?: string }; produtos?: Array<{ ncm?: string }> } } | null;
        const xml = raw?.nfeXmlData;
        const chave = digits(xml?.chave);
        const validKey = chave.length === 44;
        return [{
            numero: demand.nfNumber,
            valorTotal: Number(demand.nfValue ?? 0),
            pesoKg: Number(demand.weight ?? 0),
            cnpjEmissor: validKey ? chave.slice(6, 20) : digits(xml?.emitente?.cnpj) || undefined,
            serie: validKey ? String(Number(chave.slice(22, 25))) : String(xml?.serie || '1'),
            ncm: digits(xml?.produtos?.[0]?.ncm).slice(0, 4) || undefined,
        }];
    });
    if (!notas.length) throw new AppError('Nenhuma NF-e com número na viagem para informar ao CIOT.', 400);
    return notas;
}

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
        person?: { findFirst: (...args: any[]) => Promise<any> };
    };
    ensureIntegratorPerson?: typeof ensureEfreteIntegratorPerson;
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
    const manifest = await db.manifest.findUniqueOrThrow({
        where: { id: job.manifestId },
        include: {
            vehicleAssignments: manifestVehicleAssignmentsInclude,
            legs: { include: { order: { include: { demand: true } } } },
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
    const contratadoRntrc = tractionRntrc(composition, manifest.link.rntrc);
    if (!contratadoRntrc || !manifest.link.carrierType) throw new AppError('Cavalo sem RNTRC (ou Link sem tipo de transportador) — obrigatório para CIOT.', 400);
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

    const efreteEnv = fiscalEmitter.efreteEnvironment ?? 'HOMOLOGACAO';
    const environment: EfreteEnvironment = efreteEnv === 'PRODUCAO' ? 'producao' : 'homologacao';
    const contratanteDoc = digits(fiscalEmitter.person.document).padStart(14, '0').slice(0, 14);
    const matrizCnpj = resolveMatrizCnpj(contratanteDoc, environment);
    const integradorPerson = matrizCnpj === contratanteDoc ? null : await (deps.ensureIntegratorPerson ?? ensureEfreteIntegratorPerson)(environment);
    const contratantePerson = resolveCiotContratante(fiscalEmitter.person, integradorPerson, environment);

    const { origin, destination } = manifestRouteCities(manifest);
    const origemMunicipio = await resolveIbge(origin.city, origin.state, origin.ibge);
    const contratanteMunicipio = await resolveIbge(contratantePerson.city, contratantePerson.state, contratantePerson.cityIbgeCode);
    if (!destination.city || !destination.state) throw new AppError('CIOT sem destino canônico: informe cidade e UF no manifesto ou em uma parada.', 400);
    const destinoMunicipio = await resolveIbge(destination.city, destination.state, destination.ibge);

    const linkDoc = digits(manifest.link.document);
    const driverDoc = digits(manifest.driver.document);
    const driverPhone = splitPhone(manifest.driver.phone);
    if (!driverPhone) throw new AppError('Motorista sem celular válido (DDD + número) cadastrado.', 400);

    const veiculos = composition.units.map((unit) => unit.plate);

    const tipoViagem = tipoViagemToApi[job.tipoViagem];
    const requestData = job.requestData as unknown as StoredCiotRequestData;

    const mapperInput: CiotMapperInput = {
        tipoViagem,
        idOperacaoCliente: job.idOperacaoCliente,
        matrizCnpj,
        notasFiscais: ciotNotasFiscaisFromLegs(manifest.legs, tipoViagem === 'TAC_Agregado'),
        contratante: {
            nomeOuRazaoSocial: contratantePerson.legalName,
            cpfOuCnpj: digits(contratantePerson.document),
            endereco: {
                bairro: contratantePerson.neighborhood || 'Centro',
                cep: normalizeEfreteCep(contratantePerson.cep, 'Contratante do CIOT'),
                codigoMunicipio: Number(contratanteMunicipio),
                rua: contratantePerson.address || 'S/N',
                numero: normalizeEfreteAddressNumber(contratantePerson.number),
                ...(contratantePerson.complement ? { complemento: contratantePerson.complement } : {}),
            },
            ...(tipoViagem === 'TAC_Agregado' ? { rntrc: normalizeEfreteRntrc(contratantePerson === fiscalEmitter.person ? fiscalEmitter.rntrc : contratantePerson.rntrc) } : {}),
        },
        contratado: { cpfOuCnpj: linkDoc, rntrc: normalizeEfreteRntrc(contratadoRntrc) },
        motorista: { cpfOuCnpj: driverDoc, cnh: manifest.driver.cnhNumber, celular: { ddd: driverPhone.ddd, numero: driverPhone.numero } },
        codigoMunicipioOrigem: Number(origemMunicipio),
        codigoMunicipioDestino: Number(destinoMunicipio),
        veiculos,
        ...(tipoViagem === 'Fracionado' ? { contratantesCargaFracionada: requestData.contratantesCargaFracionada ?? [] } : {}),
        requestData: { ...requestData, composicaoVeicular: composition.traction?.wheelType === 'Cavalo' && composition.trailers.length > 0 },
    };

    return { mapperInput, environment };
}
