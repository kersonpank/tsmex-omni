/**
 * Averbação do seguro por CT-e autorizado (AT&M). Falha de integração vira alerta, nunca trava a emissão do CT-e.
 * Idempotência: o registro `CargoAverbacao` é único por cálculo; reenviar o mesmo XML é seguro (AT&M devolve JA_AVERBADO).
 */
import type { CargoAverbacao, FiscalEnvironment } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { openSecret } from '../../lib/secretBox.js';
import { getObjectAsBase64 } from '../../lib/objectStorage.js';
import { createOrMergeSystemAlert } from '../systemAlertService.js';
import { averbarCte, sanitizeRaw, type AtmCredentials, type AtmResult, type AtmTransport } from './atmClient.js';

export const AVERBACAO_SWEEP_BATCH = 20;
export const AVERBACAO_MAX_TRANSIENT_ATTEMPTS = 8;
const LOCK_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 2 * 60_000;
const BACKOFF_MAX_MS = 60 * 60_000;

export interface AtmEmitterConfig {
    averbacaoProvider?: string | null;
    atmCode?: string | null;
    atmUser?: string | null;
    atmPasswordEncrypted?: string | null;
    atmEnvironment?: FiscalEnvironment | null;
}

/** Credenciais completas e provedor ATM? Devolve null caso contrário (nada acontece). */
export function resolveAtmCredentials(emitter?: AtmEmitterConfig | null): { credentials: AtmCredentials; environment: FiscalEnvironment } | null {
    if (!emitter || emitter.averbacaoProvider !== 'ATM') return null;
    if (!emitter.atmCode?.trim() || !emitter.atmUser?.trim() || !emitter.atmPasswordEncrypted) return null;
    try {
        const senha = openSecret(emitter.atmPasswordEncrypted);
        if (!senha) return null;
        return {
            credentials: { codigo: emitter.atmCode.trim(), usuario: emitter.atmUser.trim(), senha },
            environment: emitter.atmEnvironment === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO',
        };
    } catch {
        return null;
    }
}

/** Emitente usa ATM com configuração completa (sem abrir o segredo). */
export function emitterUsesAtm(emitter?: AtmEmitterConfig | null): boolean {
    return Boolean(emitter && emitter.averbacaoProvider === 'ATM' && emitter.atmCode?.trim() && emitter.atmUser?.trim() && emitter.atmPasswordEncrypted);
}

/** Valor que vai em `nAver` do MDF-e: número de averbação; protocolo só como alternativa e nunca o literal TESTE. */
export function nAverOf(row: Pick<CargoAverbacao, 'status' | 'numeroAverbacao' | 'protocolo'> | null | undefined): string | null {
    if (!row || row.status !== 'AVERBADO') return null;
    const numero = row.numeroAverbacao?.trim();
    if (numero) return numero.slice(0, 40);
    const protocolo = row.protocolo?.trim();
    return protocolo && protocolo.toUpperCase() !== 'TESTE' ? protocolo.slice(0, 40) : null;
}

export function backoffMs(attemptCount: number): number {
    return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attemptCount - 1));
}

async function loadCteXml(calc: { cteXml: string | null; cteXmlStorageKey: string | null }): Promise<string | null> {
    if (calc.cteXml?.trim()) return calc.cteXml;
    if (!calc.cteXmlStorageKey) return null;
    return Buffer.from(await getObjectAsBase64(calc.cteXmlStorageKey), 'base64').toString('utf8');
}

function safeRaw(result: AtmResult, credentials: AtmCredentials) {
    const raw = 'raw' in result ? result.raw : undefined;
    if (raw === undefined) return undefined;
    try {
        return JSON.parse(sanitizeRaw(JSON.stringify(raw), credentials)) as object;
    } catch {
        return { truncated: true };
    }
}

export interface AverbarOutcome {
    status: 'AVERBADO' | 'FAILED' | 'PENDING' | 'SKIPPED' | 'LOCKED';
    message?: string;
    numeroAverbacao?: string | null;
    protocolo?: string | null;
}

/**
 * Averba um cálculo. `force` ignora backoff e reabre FAILED (ação manual "Tentar averbar agora").
 * Trava por registro: updateMany condicional em `lockedUntil` impede duas rodadas simultâneas.
 */
export async function averbarCalculo(calcId: string, options: { force?: boolean; transport?: AtmTransport; now?: Date } = {}): Promise<AverbarOutcome> {
    const now = options.now ?? new Date();
    const calc = await prisma.orderFreightCalculation.findUnique({
        where: { id: calcId },
        select: {
            id: true, orderId: true, status: true, documentType: true, cteProtocol: true, cteXml: true, cteXmlStorageKey: true, cteCancelledAt: true,
            fiscalEmitter: { select: { averbacaoProvider: true, atmCode: true, atmUser: true, atmPasswordEncrypted: true, atmEnvironment: true } },
            cargoAverbacao: true,
        },
    });
    if (!calc || calc.documentType !== 'CTE' || calc.status !== 'CTE_AUTHORIZED' || !calc.cteProtocol || calc.cteCancelledAt) {
        return { status: 'SKIPPED', message: 'CT-e não está autorizado.' };
    }
    const config = resolveAtmCredentials(calc.fiscalEmitter);
    if (!config) return { status: 'SKIPPED', message: 'Emitente sem averbação AT&M configurada.' };
    const existing = calc.cargoAverbacao;
    if (existing?.status === 'AVERBADO') return { status: 'AVERBADO', numeroAverbacao: existing.numeroAverbacao, protocolo: existing.protocolo };
    if (!options.force) {
        if (existing?.status === 'FAILED' || existing?.status === 'CANCELLED') return { status: 'SKIPPED', message: 'Averbação em falha definitiva; use "Tentar averbar agora".' };
        if (existing?.lastAttemptAt && existing.attemptCount > 0 && now.getTime() - existing.lastAttemptAt.getTime() < backoffMs(existing.attemptCount)) {
            return { status: 'SKIPPED', message: 'Aguardando intervalo entre tentativas.' };
        }
    }

    await prisma.cargoAverbacao.upsert({
        where: { orderFreightCalculationId: calc.id },
        create: { orderFreightCalculationId: calc.id, provider: 'ATM', status: 'PENDING' },
        update: options.force && existing && existing.status !== 'PENDING' ? { status: 'PENDING', attemptCount: 0 } : {},
    });
    const claim = await prisma.cargoAverbacao.updateMany({
        where: { orderFreightCalculationId: calc.id, status: 'PENDING', OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
        data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
    });
    if (!claim.count) return { status: 'LOCKED', message: 'Averbação já em andamento.' };

    const reset = Boolean(options.force && existing && existing.status !== 'PENDING');
    const attempt = (reset ? 0 : existing?.attemptCount ?? 0) + 1;
    const finish = async (data: Record<string, unknown>) => {
        await prisma.cargoAverbacao.update({
            where: { orderFreightCalculationId: calc.id },
            data: { attemptCount: attempt, lastAttemptAt: now, lockedUntil: null, ...data },
        });
    };
    const fail = async (message: string, codigo: string): Promise<AverbarOutcome> => {
        await finish({ status: 'FAILED', lastError: `${codigo}: ${message}` });
        await createOrMergeSystemAlert({
            category: 'FISCAL_PROVIDER_ERROR',
            severity: 'WARNING',
            title: 'Averbação do seguro (AT&M) recusada',
            message: `A averbação do CT-e foi recusada (${codigo}): ${message}. Corrija o cadastro/documento ou averbe manualmente e use "Tentar averbar agora".`,
            context: { orderId: calc.orderId, calcId: calc.id, codigo },
            dedupMatch: (ctx) => ctx.calcId === calc.id,
        }).catch(() => undefined);
        return { status: 'FAILED', message: `${codigo}: ${message}` };
    };

    let xml: string | null;
    try {
        xml = await loadCteXml(calc);
    } catch (error) {
        await finish({ status: 'PENDING', lastError: `XML indisponível: ${error instanceof Error ? error.message : String(error)}` });
        return { status: 'PENDING', message: 'XML do CT-e indisponível no momento.' };
    }
    if (!xml) return fail('XML autorizado do CT-e não encontrado.', 'SEM_XML');

    const result = await averbarCte(xml, config.credentials, config.environment, options.transport);
    const raw = safeRaw(result, config.credentials);
    if (result.kind === 'AVERBADO' || result.kind === 'JA_AVERBADO') {
        await finish({
            status: 'AVERBADO',
            numeroAverbacao: result.numeroAverbacao,
            protocolo: result.protocolo,
            averbadoAt: result.dhAverbacao ? new Date(result.dhAverbacao) : now,
            lastError: null,
            rawResponse: raw as never,
        });
        return { status: 'AVERBADO', numeroAverbacao: result.numeroAverbacao, protocolo: result.protocolo };
    }
    if (result.kind === 'ERRO_DEFINITIVO') {
        await prisma.cargoAverbacao.update({ where: { orderFreightCalculationId: calc.id }, data: { rawResponse: raw as never } });
        return fail(result.mensagem, result.codigo);
    }
    if (attempt >= AVERBACAO_MAX_TRANSIENT_ATTEMPTS) return fail(`${result.mensagem} (esgotadas ${attempt} tentativas)`, result.codigo);
    await finish({ status: 'PENDING', lastError: `${result.codigo}: ${result.mensagem}`, rawResponse: raw as never });
    return { status: 'PENDING', message: `${result.codigo}: ${result.mensagem}` };
}

/** Varredor: CT-e autorizados de emitente ATM ainda sem averbação concluída. Máx. 20 por rodada. */
export async function sweepPendingAverbacoes(options: { transport?: AtmTransport; now?: Date } = {}): Promise<number> {
    const candidates = await prisma.orderFreightCalculation.findMany({
        where: {
            documentType: 'CTE',
            status: 'CTE_AUTHORIZED',
            cteProtocol: { not: null },
            cteCancelledAt: null,
            fiscalEmitter: { is: { averbacaoProvider: 'ATM', atmCode: { not: null }, atmUser: { not: null }, atmPasswordEncrypted: { not: null } } },
            OR: [{ cargoAverbacao: { is: null } }, { cargoAverbacao: { is: { status: 'PENDING' } } }],
        },
        orderBy: { cteAuthorizedAt: 'asc' },
        select: { id: true },
        take: AVERBACAO_SWEEP_BATCH,
    });
    let processed = 0;
    for (const candidate of candidates) {
        try {
            const outcome = await averbarCalculo(candidate.id, options);
            if (outcome.status !== 'SKIPPED' && outcome.status !== 'LOCKED') processed += 1;
        } catch (error) {
            console.error(JSON.stringify({ level: 'error', source: 'averbacaoSweep', calcId: candidate.id, error: error instanceof Error ? error.message : String(error) }));
        }
    }
    return processed;
}
