import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { resolveIbgeMunicipio } from '../acbr/acbrIbge.js';
import { resolveMatrizCnpj, type EfreteEnvironment } from '../efrete/efreteConfig.js';
import { digits, splitPhone } from '../efrete/efreteUtil.js';
import type { CiotMapperInput, CiotRequestData, CiotTipoViagemApi } from '../efrete/efreteCiotMapper.js';

/** Formato persistido em `CiotEmissionJob.requestData` — Carta Frete + campos que só existem no Fracionado. */
export type StoredCiotRequestData = CiotRequestData & { contratantesCargaFracionada?: string[] };

const tipoViagemToApi: Record<string, CiotTipoViagemApi> = {
    PADRAO: 'Padrao',
    FRACIONADO: 'Fracionado',
    TAC_AGREGADO: 'TAC_Agregado',
};

export async function buildCiotEmissionInputForJob(ciotEmissionJobId: string): Promise<{
    mapperInput: CiotMapperInput;
    environment: EfreteEnvironment;
}> {
    const job = await prisma.ciotEmissionJob.findUniqueOrThrow({ where: { id: ciotEmissionJobId } });
    const manifest = await prisma.manifest.findUniqueOrThrow({
        where: { id: job.manifestId },
        include: {
            hub: { include: { person: true } },
            destHub: { include: { person: true } },
            link: { include: { person: true } },
            driver: { include: { person: true } },
        },
    });

    if (!manifest.hub?.person) throw new AppError('Manifesto sem Hub com pessoa (CNPJ) para resolver o Contratante do CIOT.', 400);
    if (!manifest.destHub?.person) throw new AppError('Manifesto sem Hub de destino para resolver o município de descarga do CIOT.', 400);
    if (!manifest.link) throw new AppError('Manifesto sem Link (transportador) atribuído.', 400);
    if (!manifest.link.rntrc || !manifest.link.carrierType) throw new AppError('Link sem RNTRC/tipo de transportador cadastrado — obrigatório para CIOT.', 400);
    if (!manifest.driver) throw new AppError('Manifesto sem motorista definido ("Definir Motorista") — obrigatório para CIOT.', 400);
    if (!manifest.driver.cnhNumber) throw new AppError('Motorista sem número de CNH cadastrado.', 400);

    const fiscalEmitter = await prisma.fiscalEmitter.findFirst({
        where: { hubId: manifest.hubId ?? undefined, active: true },
        orderBy: [{ defaultForHub: 'desc' }, { updatedAt: 'desc' }],
        include: { person: true },
    });
    if (!fiscalEmitter?.person) throw new AppError('Hub sem FiscalEmitter ativo — obrigatório como Contratante do CIOT.', 400);

    const environment: EfreteEnvironment = fiscalEmitter.environment === 'PRODUCAO' ? 'producao' : 'homologacao';
    const contratanteDoc = digits(fiscalEmitter.person.document).padStart(14, '0').slice(0, 14);
    const matrizCnpj = resolveMatrizCnpj(contratanteDoc, environment);

    const origemMunicipio = await resolveIbgeMunicipio(manifest.hub.city, manifest.hub.state, manifest.hub.cityIbgeCode);
    const destinoMunicipio = await resolveIbgeMunicipio(manifest.destHub.city, manifest.destHub.state, manifest.destHub.cityIbgeCode);

    const linkDoc = digits(manifest.link.document);
    const driverDoc = digits(manifest.driver.document);
    const driverPhone = splitPhone(manifest.driver.phone);
    if (!driverPhone) throw new AppError('Motorista sem celular válido (DDD + número) cadastrado.', 400);

    const veiculos = [manifest.link.vehiclePlate, ...(manifest.link.trailerPlate ? [manifest.link.trailerPlate] : [])].map((p) =>
        p.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
    );

    const tipoViagem = tipoViagemToApi[job.tipoViagem];
    const requestData = job.requestData as unknown as StoredCiotRequestData;

    const mapperInput: CiotMapperInput = {
        tipoViagem,
        idOperacaoCliente: job.idOperacaoCliente,
        matrizCnpj,
        contratante: {
            nomeOuRazaoSocial: fiscalEmitter.person.legalName,
            cpfOuCnpj: contratanteDoc,
            endereco: {
                bairro: fiscalEmitter.person.neighborhood || 'Centro',
                cep: digits(fiscalEmitter.person.cep).padStart(8, '0').slice(0, 8),
                codigoMunicipio: Number(origemMunicipio),
                rua: fiscalEmitter.person.address || 'S/N',
                numero: fiscalEmitter.person.number || 'S/N',
                ...(fiscalEmitter.person.complement ? { complemento: fiscalEmitter.person.complement } : {}),
            },
            ...(tipoViagem === 'TAC_Agregado' ? { rntrc: digits(fiscalEmitter.rntrc ?? '').padStart(9, '0').slice(0, 9) } : {}),
        },
        contratado: { cpfOuCnpj: linkDoc, rntrc: digits(manifest.link.rntrc).padStart(9, '0').slice(0, 9) },
        motorista: { cpfOuCnpj: driverDoc, cnh: manifest.driver.cnhNumber, celular: { ddd: driverPhone.ddd, numero: driverPhone.numero } },
        codigoMunicipioOrigem: Number(origemMunicipio),
        codigoMunicipioDestino: Number(destinoMunicipio),
        veiculos,
        ...(tipoViagem === 'Fracionado' ? { contratantesCargaFracionada: requestData.contratantesCargaFracionada ?? [] } : {}),
        requestData,
    };

    return { mapperInput, environment };
}
