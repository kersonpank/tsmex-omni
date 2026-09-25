import { randomInt } from 'node:crypto';
import prisma from '../../lib/prisma.js';
import { AcbrHttpError } from './acbrHttp.js';

/** cMDF: código numérico de 8 dígitos do leiaute 3.00, gerado uma vez por MDF-e e persistido junto do documento. */
export function generateCMdf(): string {
    return String(randomInt(10_000_000, 100_000_000));
}

/**
 * O POST /mdfe falhou de forma DEFINITIVA (o provedor recusou a requisição, nada foi criado)?
 * 4xx explícito = sim (exceto 408/429, que são transitórios). Timeout, erro de rede e 5xx = NÃO:
 * o MDF-e pode ter sido criado no provedor, então o resultado é desconhecido e precisa de conciliação —
 * nunca reemitir (novo número) nem marcar como rejeitado.
 */
export function isDefinitiveMdfeRejection(error: unknown): boolean {
    if (!(error instanceof AcbrHttpError)) return false;
    return error.httpStatus >= 400 && error.httpStatus < 500 && error.httpStatus !== 408 && error.httpStatus !== 429;
}

/** Reserva (incrementa atomicamente) o próximo nº de MDF-e do emitente. */
export async function reserveNextMdfeNumber(fiscalEmitterId: string): Promise<{ nMDF: number; serie: number }> {
    const emitter = await prisma.fiscalEmitter.update({
        where: { id: fiscalEmitterId },
        data: { lastMdfeNumber: { increment: 1 } },
        select: { lastMdfeNumber: true, mdfeSeries: true },
    });
    return { nMDF: emitter.lastMdfeNumber, serie: emitter.mdfeSeries };
}
