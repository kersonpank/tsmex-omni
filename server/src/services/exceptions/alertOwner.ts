import prisma from '../../lib/prisma.js';

/** Prazo padrão (horas) por tipo de alerta operacional: quem precisa agir e até quando. */
export const DEFAULT_DUE_HOURS = {
    ARRIVAL_DIVERGENCE: 24,
    FISCAL_CLOSURE: 4,
} as const;

export function dueIn(hours: number, from: Date = new Date()): Date {
    return new Date(from.getTime() + hours * 3_600_000);
}

type ManifestHubDb = {
    manifest: { findUnique: (args: { where: { id: string }; select: { hubId: true } }) => Promise<{ hubId: string | null } | null> };
};

/** Hub de origem da viagem (dono do problema quando o alerta só conhece o manifestId). */
export async function originHubIdOfManifest(manifestId: string, db: ManifestHubDb = prisma as unknown as ManifestHubDb): Promise<string | null> {
    try {
        const row = await db.manifest.findUnique({ where: { id: manifestId }, select: { hubId: true } });
        return row?.hubId ?? null;
    } catch {
        // Descobrir o dono é best-effort: nunca derruba o fluxo que está gerando o alerta.
        return null;
    }
}
