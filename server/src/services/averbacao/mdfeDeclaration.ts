/**
 * Declaração do MDF-e autorizado na AT&M (`declaraMDFe`), que também averba o RC-V (ramo 59):
 * a resposta traz a chancela (`Declarado`) e, separadamente, o resultado do seguro (`ErroRCV` em recusa).
 * Estado em `ManifestAverbacao` (um por documento MDFE). Validado em homologação em 2026-11-11.
 * Best-effort: nunca lança e nunca desfaz a autorização do MDF-e; falha definitiva vira SystemAlert.
 */
import prisma from '../../lib/prisma.js';
import { getObjectAsBase64 } from '../../lib/objectStorage.js';
import { createOrMergeSystemAlert } from '../systemAlertService.js';
import { declararMdfe, sanitizeRaw, type AtmCredentials, type AtmMdfeResult, type AtmTransport } from './atmClient.js';
import { backoffMs, resolveAtmCredentials } from './cargoAverbacaoService.js';

export const MDFE_AVERBACAO_MAX_ATTEMPTS = 8;
export const MDFE_AVERBACAO_SWEEP_BATCH = 20;
const MDFE_AVERBACAO_WINDOW_MS = 7 * 24 * 60 * 60_000;
const LOCK_MS = 5 * 60_000;

export interface MdfeAverbarOutcome {
    status: 'RCV_AVERBADO' | 'RCV_RECUSADO' | 'DECLARADO' | 'PENDING' | 'FAILED' | 'SKIPPED' | 'LOCKED' | 'SEM_ATM' | 'DESLIGADO';
    message?: string;
    rcvCodigo?: string | null;
    rcvMensagem?: string | null;
}

function safeRaw(result: AtmMdfeResult, credentials: AtmCredentials): object | undefined {
    const raw = 'raw' in result ? result.raw : undefined;
    if (raw === undefined) return undefined;
    try {
        return JSON.parse(sanitizeRaw(JSON.stringify(raw), credentials)) as object;
    } catch {
        return { truncated: true };
    }
}

async function loadMdfeXml(xmlUrl: string | null): Promise<string | null> {
    if (!xmlUrl) return null;
    return Buffer.from(await getObjectAsBase64(xmlUrl), 'base64').toString('utf8');
}

/**
 * Declara (ou re-declara) um MDF-e autorizado. `xml` evita ir ao storage na primeira tentativa.
 * `force` ignora o intervalo e reabre recusa/falha (botão "Tentar de novo").
 */
export async function averbarMdfeDocumento(
    docId: string,
    options: { xml?: string; force?: boolean; transport?: AtmTransport; now?: Date } = {},
): Promise<MdfeAverbarOutcome> {
    const now = options.now ?? new Date();
    const doc = await prisma.manifestFiscalDocument.findUnique({
        where: { id: docId },
        select: {
            id: true, manifestId: true, documentType: true, status: true, xmlUrl: true, number: true,
            fiscalEmitter: { select: { averbacaoProvider: true, atmCode: true, atmUser: true, atmPasswordEncrypted: true, atmEnvironment: true, atmDeclareMdfe: true } },
            averbacao: true,
        },
    });
    if (!doc || doc.documentType !== 'MDFE' || (doc.status !== 'AUTHORIZED' && doc.status !== 'CLOSED')) {
        return { status: 'SKIPPED', message: 'MDF-e não está autorizado.' };
    }
    const config = resolveAtmCredentials(doc.fiscalEmitter);
    if (!config) return { status: 'SEM_ATM', message: 'Emitente sem averbação AT&M configurada.' };
    if (doc.fiscalEmitter?.atmDeclareMdfe === false) return { status: 'DESLIGADO', message: 'Emitente não averba o MDF-e na AT&M.' };

    const existing = doc.averbacao;
    if (existing && !options.force) {
        if (existing.status !== 'PENDING') return { status: existing.status, message: existing.lastError ?? existing.rcvMensagem ?? undefined };
        const freshCall = Boolean(options.xml);
        if (!freshCall && existing.lastAttemptAt && existing.attemptCount > 0 && now.getTime() - existing.lastAttemptAt.getTime() < backoffMs(existing.attemptCount)) {
            return { status: 'SKIPPED', message: 'Aguardando intervalo entre tentativas.' };
        }
    }
    if (existing?.status === 'RCV_AVERBADO' && options.force) return { status: 'RCV_AVERBADO' };

    const reset = Boolean(options.force && existing && existing.status !== 'PENDING');
    await prisma.manifestAverbacao.upsert({
        where: { manifestFiscalDocumentId: doc.id },
        create: { manifestFiscalDocumentId: doc.id, status: 'PENDING' },
        update: reset ? { status: 'PENDING', attemptCount: 0, rcvCodigo: null, rcvMensagem: null, lastError: null } : {},
    });
    const claim = await prisma.manifestAverbacao.updateMany({
        where: { manifestFiscalDocumentId: doc.id, status: 'PENDING', OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
        data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
    });
    if (!claim.count) return { status: 'LOCKED', message: 'Declaração já em andamento.' };

    const attempt = (reset ? 0 : existing?.attemptCount ?? 0) + 1;
    const finish = (data: Record<string, unknown>) => prisma.manifestAverbacao.update({
        where: { manifestFiscalDocumentId: doc.id },
        data: { attemptCount: attempt, lastAttemptAt: now, lockedUntil: null, ...data },
    });
    const alert = (title: string, message: string, codigo: string) => createOrMergeSystemAlert({
        category: 'FISCAL_PROVIDER_ERROR',
        severity: 'WARNING',
        title,
        message,
        context: { manifestId: doc.manifestId, docId: doc.id, codigo, kind: 'MDFE_AVERBACAO' },
        dedupMatch: (ctx) => ctx.docId === doc.id && ctx.kind === 'MDFE_AVERBACAO',
    }).catch(() => undefined);
    const fail = async (codigo: string, mensagem: string, raw?: object): Promise<MdfeAverbarOutcome> => {
        await finish({ status: 'FAILED', lastError: `${codigo}: ${mensagem}`, ...(raw ? { rawResponse: raw as never } : {}) });
        await alert('Declaração do MDF-e na AT&M não concluída', `A AT&M não aceitou a declaração do MDF-e (${codigo}): ${mensagem}. O MDF-e segue autorizado; use "Averbar de novo" na viagem depois de resolver.`, codigo);
        return { status: 'FAILED', message: `${codigo}: ${mensagem}` };
    };

    let xml = options.xml ?? null;
    if (!xml) {
        try {
            xml = await loadMdfeXml(doc.xmlUrl);
        } catch (error) {
            await finish({ status: 'PENDING', lastError: `XML indisponível: ${error instanceof Error ? error.message : String(error)}` });
            return { status: 'PENDING', message: 'XML do MDF-e indisponível no momento.' };
        }
    }
    if (!xml) return fail('SEM_XML', 'XML autorizado do MDF-e não encontrado.');

    const result = await declararMdfe(xml, config.credentials, config.environment, options.transport);
    const raw = safeRaw(result, config.credentials);
    if (result.kind === 'ERRO_DEFINITIVO') return fail(result.codigo, result.mensagem, raw);
    if (result.kind === 'ERRO_TRANSITORIO') {
        if (attempt >= MDFE_AVERBACAO_MAX_ATTEMPTS) return fail(result.codigo, `${result.mensagem} (esgotadas ${attempt} tentativas)`, raw);
        await finish({ status: 'PENDING', lastError: `${result.codigo}: ${result.mensagem}`, ...(raw ? { rawResponse: raw as never } : {}) });
        return { status: 'PENDING', message: `${result.codigo}: ${result.mensagem}` };
    }

    const chancela = {
        protocolo: result.protocolo,
        chancelaAt: result.dhChancela && !Number.isNaN(new Date(result.dhChancela).getTime()) ? new Date(result.dhChancela) : now,
        rawResponse: raw as never,
    };
    const { rcv } = result;
    if (rcv.status === 'AVERBADO') {
        await finish({ ...chancela, status: 'RCV_AVERBADO', rcvCodigo: null, rcvMensagem: null, lastError: null });
        return { status: 'RCV_AVERBADO' };
    }
    if (rcv.status === 'RECUSADO') {
        await finish({ ...chancela, status: 'RCV_RECUSADO', rcvCodigo: rcv.codigo, rcvMensagem: rcv.mensagem, lastError: null });
        await alert('Seguro do veículo (RC-V) do MDF-e recusado pela AT&M', `A AT&M recusou o RC-V do MDF-e ${doc.number ?? ''} (${rcv.codigo}): ${rcv.mensagem}. Não libere o embarque sem resolver com a corretora/seguradora.`, rcv.codigo);
        return { status: 'RCV_RECUSADO', rcvCodigo: rcv.codigo, rcvMensagem: rcv.mensagem };
    }
    if (rcv.status === 'TRANSITORIO' && attempt < MDFE_AVERBACAO_MAX_ATTEMPTS) {
        await finish({ ...chancela, status: 'PENDING', lastError: `${rcv.codigo}: ${rcv.mensagem}` });
        return { status: 'PENDING', message: `${rcv.codigo}: ${rcv.mensagem}` };
    }
    await finish({ ...chancela, status: 'DECLARADO', rcvCodigo: null, rcvMensagem: null, lastError: null });
    return { status: 'DECLARADO' };
}

/** Ponto de chamada logo após a autorização do MDF-e (acbrMdfeEmit.ts). Nunca lança. */
export async function declararMdfeAposAutorizacao(
    input: { docId: string; xml: string },
    options: { transport?: AtmTransport } = {},
): Promise<MdfeAverbarOutcome['status'] | 'FALHOU'> {
    try {
        return (await averbarMdfeDocumento(input.docId, { xml: input.xml, transport: options.transport })).status;
    } catch (error) {
        console.error(JSON.stringify({ level: 'error', source: 'atmDeclaraMdfe', docId: input.docId, error: error instanceof Error ? error.message : String(error) }));
        return 'FALHOU';
    }
}

/** Varredor: MDF-e autorizados (últimos 7 dias) de emitente ATM sem declaração concluída. */
export async function sweepPendingMdfeAverbacoes(options: { transport?: AtmTransport; now?: Date } = {}): Promise<number> {
    const now = options.now ?? new Date();
    const candidates = await prisma.manifestFiscalDocument.findMany({
        where: {
            documentType: 'MDFE',
            status: 'AUTHORIZED',
            authorizedAt: { gte: new Date(now.getTime() - MDFE_AVERBACAO_WINDOW_MS) },
            fiscalEmitter: { is: { averbacaoProvider: 'ATM', atmDeclareMdfe: true, atmCode: { not: null }, atmUser: { not: null }, atmPasswordEncrypted: { not: null } } },
            OR: [{ averbacao: { is: null } }, { averbacao: { is: { status: 'PENDING' } } }],
        },
        orderBy: { authorizedAt: 'asc' },
        select: { id: true },
        take: MDFE_AVERBACAO_SWEEP_BATCH,
    });
    let processed = 0;
    for (const candidate of candidates) {
        try {
            const outcome = await averbarMdfeDocumento(candidate.id, options);
            if (outcome.status !== 'SKIPPED' && outcome.status !== 'LOCKED') processed += 1;
        } catch (error) {
            console.error(JSON.stringify({ level: 'error', source: 'mdfeAverbacaoSweep', docId: candidate.id, error: error instanceof Error ? error.message : String(error) }));
        }
    }
    return processed;
}
