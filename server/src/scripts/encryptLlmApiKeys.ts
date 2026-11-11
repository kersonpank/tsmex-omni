/**
 * Cifra, em lote e de forma idempotente, as chaves de LLM ainda em texto puro (LLMApiKey.apiKey).
 * Uso (com DATABASE_URL e FISCAL_SECRET_KEY no ambiente):
 *   npx tsx src/scripts/encryptLlmApiKeys.ts            # executa
 *   npx tsx src/scripts/encryptLlmApiKeys.ts --dry-run  # só conta
 * Valores já cifrados (prefixo v1:) são ignorados. Nunca imprime chaves.
 */
import prisma from '../lib/prisma.js';
import { isSealedSecret, sealSecret } from '../lib/secretBox.js';

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    if (!dryRun && !process.env.FISCAL_SECRET_KEY) {
        throw new Error('FISCAL_SECRET_KEY é obrigatória para cifrar as chaves.');
    }
    const rows = await prisma.lLMApiKey.findMany({ select: { id: true, apiKey: true } });
    let encrypted = 0;
    let skipped = 0;
    for (const row of rows) {
        if (!row.apiKey || isSealedSecret(row.apiKey)) {
            skipped++;
            continue;
        }
        if (!dryRun) {
            await prisma.lLMApiKey.update({ where: { id: row.id }, data: { apiKey: sealSecret(row.apiKey.trim()) } });
        }
        encrypted++;
    }
    console.log(`${dryRun ? '[dry-run] ' : ''}chaves cifradas: ${encrypted}; já cifradas/vazias: ${skipped}; total: ${rows.length}`);
}

main()
    .catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
