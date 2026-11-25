import prisma from '../../lib/prisma.js';
import { linkVehicleInclude, manifestVehicleAssignmentsInclude } from '../vehicleUnitService.js';
import { normalizePlate, resolveManifestComposition } from '../vehicleUnitRules.js';

/**
 * Antes de emitir o MDF-e: a placa de tração da viagem tem outro MDF-e ainda aberto (autorizado e não
 * encerrado)? A SEFAZ rejeita o novo ("existe MDF-e não encerrado para esta placa"), então o TSM avisa antes.
 *
 * Fontes, da mais confiável para a menos:
 * - TSM: MDF-e AUTHORIZED de OUTRA viagem com a mesma placa de tração (bloqueia sempre);
 * - FISCAL_EXTERNO: MDF-e do legado importado por XML (`ExternalFiscalDocument`) ainda AUTHORIZED;
 * - HISTORICO_LEGADO: MDF-e do legado no histórico importado (`LegacyRecord` viagem_mdfes com situação
 *   "A" = autorizado), cruzado com a placa da viagem do legado. É uma foto da data da importação.
 * As duas fontes externas bloqueiam até alguém confirmar que já foram encerradas (`confirmExternal`).
 */
export type OpenMdfeSource = 'TSM' | 'FISCAL_EXTERNO' | 'HISTORICO_LEGADO';

export interface OpenMdfe {
    source: OpenMdfeSource;
    plate: string;
    accessKey: string | null;
    number: string | null;
    reference: string;
    authorizedAt: Date | null;
}

export interface OpenMdfeCheck {
    plate: string | null;
    open: OpenMdfe[];
    /** Há bloqueio que nenhuma confirmação libera (MDF-e aberto emitido pelo próprio TSM). */
    blockedByTsm: boolean;
    /** Há aberto só em fonte externa: libera com confirmação de que já foi encerrado. */
    needsExternalConfirmation: boolean;
}

const LEGACY_OPEN_STATUS = 'A';

/** Placa de tração do MDF-e guardado (`rawPayload.infMDFe.infModal.rodo.veicTracao.placa`). */
export function payloadTractionPlate(rawPayload: unknown): string | null {
    const placa = (rawPayload as { infMDFe?: { infModal?: { rodo?: { veicTracao?: { placa?: unknown } } } } } | null)
        ?.infMDFe?.infModal?.rodo?.veicTracao?.placa;
    return typeof placa === 'string' && placa.trim() ? normalizePlate(placa) : null;
}

/** Placa de tração no XML autorizado de um MDF-e (primeiro `<placa>` dentro de `<veicTracao>`). */
export function xmlTractionPlate(xml: string): string | null {
    const block = /<veicTracao>([\s\S]*?)<\/veicTracao>/.exec(xml)?.[1];
    const placa = block ? /<placa>([^<]+)<\/placa>/.exec(block)?.[1] : undefined;
    return placa ? normalizePlate(placa) : null;
}

export function summarizeOpenMdfe(plate: string | null, open: OpenMdfe[]): OpenMdfeCheck {
    const blockedByTsm = open.some((o) => o.source === 'TSM');
    return { plate, open, blockedByTsm, needsExternalConfirmation: !blockedByTsm && open.length > 0 };
}

export async function manifestTractionPlate(manifestId: string, db: typeof prisma = prisma): Promise<string | null> {
    const manifest = await db.manifest.findUnique({
        where: { id: manifestId },
        select: { compositionSnapshot: true, vehicleAssignments: manifestVehicleAssignmentsInclude, link: { include: linkVehicleInclude } },
    });
    if (!manifest) return null;
    try {
        const plate = resolveManifestComposition(manifest as Parameters<typeof resolveManifestComposition>[0]).traction?.plate;
        return plate ? normalizePlate(plate) : null;
    } catch {
        return null;
    }
}

export async function findOpenMdfeForManifest(manifestId: string, db: typeof prisma = prisma): Promise<OpenMdfeCheck> {
    const plate = await manifestTractionPlate(manifestId, db);
    if (!plate) return summarizeOpenMdfe(null, []);
    const open: OpenMdfe[] = [];

    const tsmDocs = await db.manifestFiscalDocument.findMany({
        where: { documentType: 'MDFE', status: 'AUTHORIZED', manifestId: { not: manifestId } },
        select: { id: true, manifestId: true, number: true, accessKey: true, authorizedAt: true, rawPayload: true },
    });
    for (const doc of tsmDocs) {
        if (payloadTractionPlate(doc.rawPayload) !== plate) continue;
        open.push({ source: 'TSM', plate, accessKey: doc.accessKey, number: doc.number, reference: `viagem ${doc.manifestId.slice(0, 8)} do TSM`, authorizedAt: doc.authorizedAt });
    }

    const externalDocs = await db.externalFiscalDocument.findMany({
        where: { model: 'MDFE', status: 'AUTHORIZED', xml: { contains: plate } },
        select: { accessKey: true, number: true, series: true, authorizedAt: true, xml: true },
    });
    for (const doc of externalDocs) {
        if (xmlTractionPlate(doc.xml) !== plate) continue;
        open.push({ source: 'FISCAL_EXTERNO', plate, accessKey: doc.accessKey, number: String(doc.number), reference: `legado série ${doc.series}`, authorizedAt: doc.authorizedAt });
    }

    const keysSeen = new Set(open.map((o) => o.accessKey).filter(Boolean));
    const legacyOpen = await db.$queryRaw<Array<{ chave: string | null; manifesto: string | null; viagem: string | null }>>`
        SELECT m.data->>'chave' AS chave, m.data->>'manifesto' AS manifesto, m.data->>'viagem_numero' AS viagem
        FROM "LegacyRecord" m
        JOIN "LegacyRecord" v ON v.entity = 'viagens' AND v.data->>'numero' = m.data->>'viagem_numero'
        WHERE m.entity = 'viagem_mdfes' AND m.data->>'status' = ${LEGACY_OPEN_STATUS}
          AND upper(regexp_replace(coalesce(v.data->>'veiculo', ''), '[^A-Za-z0-9]', '', 'g')) = ${plate}`;
    for (const row of legacyOpen) {
        if (row.chave && keysSeen.has(row.chave)) continue;
        open.push({ source: 'HISTORICO_LEGADO', plate, accessKey: row.chave, number: row.manifesto, reference: `viagem ${row.viagem ?? '?'} do legado`, authorizedAt: null });
    }
    return summarizeOpenMdfe(plate, open);
}

/** Mensagem curta para o operador, listando o que está aberto e o que fazer. */
export function describeOpenMdfe(check: OpenMdfeCheck): string {
    const items = check.open.map((o) => `MDF-e ${o.number ?? '?'} (${o.reference})`).join('; ');
    if (check.blockedByTsm) return `A placa ${check.plate} tem MDF-e aberto em outra viagem do TSM: ${items}. Encerre-o antes de emitir este.`;
    return `A placa ${check.plate} tem MDF-e aberto emitido pelo legado: ${items}. Encerre-o no legado (ou confirme que já foi encerrado) antes de emitir.`;
}
