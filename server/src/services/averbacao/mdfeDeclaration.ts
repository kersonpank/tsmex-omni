/**
 * declaraMDFe (AT&M) após o MDF-e autorizado. DESLIGADO por padrão (`ATM_DECLARA_MDFE=true` liga):
 * o contrato dessa operação não foi confirmado pela AT&M (o manual v3.0 não a documenta).
 * Best-effort: nunca lança e nunca bloqueia a emissão; falha vira SystemAlert.
 */
import prisma from '../../lib/prisma.js';
import { createOrMergeSystemAlert } from '../systemAlertService.js';
import { declararMdfe, type AtmTransport } from './atmClient.js';
import { resolveAtmCredentials } from './cargoAverbacaoService.js';

export function atmDeclaraMdfeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.ATM_DECLARA_MDFE?.trim().toLowerCase() === 'true';
}

export async function declararMdfeAposAutorizacao(input: { docId: string; xml: string }, options: { transport?: AtmTransport; env?: NodeJS.ProcessEnv } = {}): Promise<'DESLIGADO' | 'SEM_ATM' | 'OK' | 'FALHOU'> {
    if (!atmDeclaraMdfeEnabled(options.env)) return 'DESLIGADO';
    try {
        const doc = await prisma.manifestFiscalDocument.findUnique({
            where: { id: input.docId },
            select: { id: true, manifestId: true, fiscalEmitter: { select: { averbacaoProvider: true, atmCode: true, atmUser: true, atmPasswordEncrypted: true, atmEnvironment: true } } },
        });
        const config = resolveAtmCredentials(doc?.fiscalEmitter);
        if (!doc || !config) return 'SEM_ATM';
        const result = await declararMdfe(input.xml, config.credentials, config.environment, options.transport);
        if (result.kind === 'AVERBADO' || result.kind === 'JA_AVERBADO') return 'OK';
        const mensagem = 'mensagem' in result ? result.mensagem : 'resposta inesperada';
        const codigo = 'codigo' in result ? result.codigo : '';
        await createOrMergeSystemAlert({
            category: 'FISCAL_PROVIDER_ERROR', severity: 'WARNING',
            title: 'Declaração do MDF-e na AT&M não concluída',
            message: `A AT&M não confirmou a declaração do MDF-e (${codigo}): ${mensagem}. O MDF-e segue autorizado; declare manualmente se a apólice exigir.`,
            context: { manifestId: doc.manifestId, docId: doc.id, codigo },
            dedupMatch: (ctx) => ctx.docId === doc.id,
        });
        return 'FALHOU';
    } catch (error) {
        console.error(JSON.stringify({ level: 'error', source: 'atmDeclaraMdfe', docId: input.docId, error: error instanceof Error ? error.message : String(error) }));
        return 'FALHOU';
    }
}
