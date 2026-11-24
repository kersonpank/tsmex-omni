/**
 * Carga em massa do arquivo fiscal externo (XMLs de CT-e/MDF-e e eventos emitidos no sistema
 * legado). Idempotente: pode rodar de novo sobre a mesma pasta (o que já entrou vira "duplicate").
 *
 * Uso (DATABASE_URL no ambiente):
 *   node dist/scripts/importExternalFiscal.js /caminho/da/pasta [--dry-run] [--source LEGADO] [--note "export 21/10"] [--report relatorio.csv]
 *   npx tsx src/scripts/importExternalFiscal.ts ...   (desenvolvimento)
 *
 * - Varre a pasta recursivamente por *.xml; importa documentos primeiro e eventos depois.
 * - --dry-run só lê e valida (chave/DV, protocolo) sem gravar.
 * - Gera um CSV de conferência (arquivo, resultado, chave, motivo) para a TSM assinar.
 * - Nunca imprime o conteúdo dos XMLs.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import prisma from '../lib/prisma.js';
import { importExternalFiscalXml, externalNumberingSummary } from '../services/fiscal/external/importExternalFiscal.js';
import { FiscalXmlError, parseFiscalXml } from '../services/fiscal/external/parseFiscalXml.js';

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function listXml(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await listXml(full)));
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) out.push(full);
    }
    return out.sort();
}

const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

async function main() {
    const dir = process.argv[2];
    if (!dir || dir.startsWith('--')) throw new Error('Informe a pasta com os XMLs. Ex.: importExternalFiscal.js ./xml-legado');
    const dryRun = process.argv.includes('--dry-run');
    const sourceSystem = arg('--source') ?? 'LEGADO';
    const sourceNote = arg('--note') ?? null;
    const reportPath = arg('--report') ?? `import-fiscal-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;

    const files = await listXml(path.resolve(dir));
    const loaded: Array<{ file: string; xml: string; isEvent: boolean }> = [];
    for (const file of files) {
        const xml = await readFile(file, 'utf8');
        loaded.push({ file, xml, isEvent: /<procEvento(CTe|MDFe)\b/.test(xml) });
    }
    const ordered = [...loaded.filter((f) => !f.isEvent), ...loaded.filter((f) => f.isEvent)];

    const counts: Record<string, number> = {};
    const lines = ['arquivo,resultado,chave,detalhe'];
    let done = 0;
    for (const { file, xml } of ordered) {
        let result: string;
        let key = '';
        let detail = '';
        if (dryRun) {
            try {
                const parsed = parseFiscalXml(xml);
                result = parsed.kind === 'document' ? `ok-${parsed.doc.model}` : `ok-evento-${parsed.event.tpEvento}`;
                key = parsed.kind === 'document' ? parsed.doc.accessKey : parsed.event.accessKey;
                if (parsed.kind === 'document' && parsed.doc.cStat !== 100 && parsed.doc.cStat !== 150) {
                    result = 'rejected';
                    detail = `cStat ${parsed.doc.cStat ?? '(sem protocolo)'}`;
                }
            } catch (err) {
                result = 'rejected';
                detail = err instanceof FiscalXmlError ? err.message : String(err);
            }
        } else {
            const outcome = await importExternalFiscalXml(xml, { sourceSystem, sourceNote });
            result = outcome.result;
            key = 'accessKey' in outcome ? outcome.accessKey : '';
            detail = outcome.result === 'rejected' ? outcome.reason : 'tpEvento' in outcome ? `evento ${outcome.tpEvento}` : '';
        }
        counts[result] = (counts[result] ?? 0) + 1;
        lines.push([csv(path.relative(dir, file)), csv(result), csv(key), csv(detail)].join(','));
        done++;
        if (done % 1000 === 0) console.log(`… ${done}/${ordered.length}`);
    }
    await writeFile(reportPath, `${lines.join('\n')}\n`, 'utf8');

    console.log(`${dryRun ? '[dry-run] ' : ''}arquivos: ${files.length}`);
    for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`);
    console.log(`relatório de conferência: ${reportPath}`);
    if (!dryRun) {
        console.log('maior número por emitente/modelo/série/ambiente (confira antes de configurar o TSM):');
        for (const r of await externalNumberingSummary()) {
            console.log(`  ${r.emitterCnpj} ${r.model} série ${r.series} ${r.environment}: último ${r.lastNumber} (${r.count} docs, último em ${r.lastIssuedAt?.toISOString().slice(0, 10) ?? '-'})`);
        }
    }
}

main()
    .catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
