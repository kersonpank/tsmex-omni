import { PrismaClient } from '@prisma/client';
import { downloadCteXml, downloadCtePdf } from '../src/services/acbr/acbrCteEmit.js';
import { uploadBase64Object } from '../src/lib/objectStorage.js';

const prisma = new PrismaClient();

/** Throttle simples: mesma cadência do worker (limiter 200/60s) — não estourar rate-limit da ACBr. */
const DELAY_BETWEEN_DOCS_MS = 350;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    console.log('Iniciando backfill de documentos CT-e (XML/PDF) para storage interno...');

    const pending = await prisma.orderFreightCalculation.findMany({
        where: {
            status: 'CTE_AUTHORIZED',
            OR: [{ cteXmlStorageKey: null }, { ctePdfStorageKey: null }],
        },
        select: { id: true, cteXml: true, cteXmlStorageKey: true, ctePdfStorageKey: true, cteEnvironment: true, ctePdfUrl: true },
    });

    console.log(`Encontrados ${pending.length} cálculos CT-e autorizados sem storage key.`);
    let migrated = 0;
    let skipped = 0;

    for (const calc of pending) {
        try {
            const ambiente = calc.cteEnvironment === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';
            const providerDocId = extractProviderDocIdFromLegacyPdfUrl(calc);
            if (!providerDocId) {
                console.warn(`  [skip] calc ${calc.id}: não foi possível determinar o id do documento na ACBr (provavelmente emitido em modo simulado).`);
                skipped++;
                continue;
            }

            let xmlStorageKey = calc.cteXmlStorageKey;
            if (!xmlStorageKey) {
                const xml = calc.cteXml ?? (await downloadCteXml(providerDocId, ambiente));
                const uploaded = await uploadBase64Object({
                    base64: Buffer.from(xml, 'utf-8').toString('base64'),
                    fileName: `${calc.id}.xml`,
                    mimeType: 'application/xml',
                    keyPrefix: `cte/${calc.id}/xml`,
                });
                xmlStorageKey = uploaded.storageKey;
                await sleep(DELAY_BETWEEN_DOCS_MS);
            }

            let pdfStorageKey = calc.ctePdfStorageKey;
            if (!pdfStorageKey) {
                const pdf = await downloadCtePdf(providerDocId, ambiente);
                const uploaded = await uploadBase64Object({
                    base64: pdf.toString('base64'),
                    fileName: `${calc.id}.pdf`,
                    mimeType: 'application/pdf',
                    keyPrefix: `cte/${calc.id}/pdf`,
                });
                pdfStorageKey = uploaded.storageKey;
                await sleep(DELAY_BETWEEN_DOCS_MS);
            }

            await prisma.orderFreightCalculation.update({
                where: { id: calc.id },
                data: { cteXmlStorageKey: xmlStorageKey, ctePdfStorageKey: pdfStorageKey },
            });
            migrated++;
            console.log(`  [ok] calc ${calc.id} migrado.`);
        } catch (err) {
            console.error(`  [erro] calc ${calc.id}: ${err instanceof Error ? err.message : String(err)}`);
            skipped++;
        }
    }

    console.log(`Backfill concluído: ${migrated} migrados, ${skipped} pulados/com erro.`);
}

/**
 * O modelo legado guardava `ctePdfUrl` como `{baseUrl}/cte/{id}/pdf` — extrai o {id}.
 * Cálculos emitidos em modo simulado local não têm essa URL no formato ACBr (ex.: `/documents/cte/...`)
 * e devem ser pulados aqui (não existe documento real pra baixar).
 */
function extractProviderDocIdFromLegacyPdfUrl(calc: { ctePdfUrl: string | null }): string | null {
    if (!calc.ctePdfUrl) return null;
    const match = calc.ctePdfUrl.match(/\/cte\/([^/]+)\/pdf$/);
    return match ? match[1] : null;
}

main()
    .catch((err) => {
        console.error('Backfill falhou:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
