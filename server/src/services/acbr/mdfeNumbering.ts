import { randomInt } from 'node:crypto';
import prisma from '../../lib/prisma.js';
import { AcbrHttpError } from './acbrHttp.js';
import type { Prisma } from '@prisma/client';

/** cMDF: código numérico de 8 dígitos do leiaute 3.00, gerado uma vez por MDF-e e persistido junto do documento. */
export function generateCMdf(): string {
    return String(randomInt(10_000_000, 100_000_000));
}

/** MDF-e access-key check digit: 43 digits, modulo 11 with weights 2..9 right to left. */
export function calculateMdfeCheckDigit(input: { cUF: number; cnpj: string; series: number; number: number; cMDF: string; issuedAt: Date }): number {
    const yy = String(input.issuedAt.getUTCFullYear()).slice(-2);
    const mm = String(input.issuedAt.getUTCMonth() + 1).padStart(2, '0');
    const base = `${String(input.cUF).padStart(2, '0')}${yy}${mm}${input.cnpj}58${String(input.series).padStart(3, '0')}${String(input.number).padStart(9, '0')}1${input.cMDF}`;
    if (!/^\d{43}$/.test(base)) throw new Error('Dados inválidos para calcular o dígito verificador do MDF-e.');
    const sum = [...base].reverse().reduce((acc, digit, index) => acc + Number(digit) * (index % 8 + 2), 0);
    const result = 11 - sum % 11;
    return result >= 10 ? 0 : result;
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
export async function reserveNextMdfeNumber(fiscalEmitterId: string, tx: Prisma.TransactionClient = prisma): Promise<{ nMDF: number; serie: number }> {
    const emitter = await tx.fiscalEmitter.update({
        where: { id: fiscalEmitterId },
        data: { lastMdfeNumber: { increment: 1 } },
        select: { lastMdfeNumber: true, mdfeSeries: true },
    });
    return { nMDF: emitter.lastMdfeNumber, serie: emitter.mdfeSeries };
}
