import prisma from '../../lib/prisma.js';

export interface TripEmitterCandidate {
    id: string;
    hubId: string | null;
    defaultForHub: boolean;
}

/**
 * Emitente automático da viagem, sem ambiguidade:
 * 1) padrão do hub; 2) único ativo do hub; 3) padrão geral (sem hub); 4) único ativo no total.
 * Com mais de uma opção e nenhum padrão devolve null — aí a torre escolhe.
 */
export function chooseTripEmitter<T extends TripEmitterCandidate>(emitters: T[], hubId: string | null | undefined): T | null {
    if (hubId) {
        const ofHub = emitters.filter((e) => e.hubId === hubId);
        const hubDefaults = ofHub.filter((e) => e.defaultForHub);
        if (hubDefaults.length === 1) return hubDefaults[0];
        if (hubDefaults.length === 0 && ofHub.length === 1) return ofHub[0];
        if (ofHub.length > 0) return null;
    }
    const globalDefaults = emitters.filter((e) => e.hubId == null && e.defaultForHub);
    if (globalDefaults.length === 1) return globalDefaults[0];
    if (globalDefaults.length > 1) return null;
    return emitters.length === 1 ? emitters[0] : null;
}

/** Busca os emitentes ativos (CNPJ) e aplica `chooseTripEmitter`. */
export async function resolveDefaultTripEmitter(hubId: string | null | undefined) {
    const emitters = await prisma.fiscalEmitter.findMany({
        where: { active: true, person: { documentType: 'CNPJ' } },
        select: { id: true, hubId: true, defaultForHub: true, displayName: true, tradeName: true, person: { select: { legalName: true } } },
        orderBy: { createdAt: 'asc' },
    });
    const picked = chooseTripEmitter(emitters, hubId);
    if (!picked) return null;
    return { id: picked.id, name: picked.displayName ?? picked.tradeName ?? picked.person?.legalName ?? null };
}

/** Grava o emitente automático em rascunho sem emitente. Idempotente; devolve o id gravado ou null. */
export async function ensureTripEmitter(manifestId: string): Promise<string | null> {
    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        select: { status: true, hubId: true, fiscalEmitterId: true },
    });
    if (!manifest || manifest.fiscalEmitterId || manifest.status !== 'DRAFT') return manifest?.fiscalEmitterId ?? null;
    const resolved = await resolveDefaultTripEmitter(manifest.hubId);
    if (!resolved) return null;
    await prisma.manifest.updateMany({ where: { id: manifestId, fiscalEmitterId: null, status: 'DRAFT' }, data: { fiscalEmitterId: resolved.id } });
    return resolved.id;
}
