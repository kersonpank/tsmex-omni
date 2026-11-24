/**
 * Carga de cadastros do sistema legado a partir do CSV exportado pelas listagens dele.
 *
 *   node dist/scripts/importLegacyMasterData.js persons  pessoas.csv   [--dry-run] [--report r.csv]
 *   node dist/scripts/importLegacyMasterData.js vehicles veiculos.csv  [--dry-run]
 *   node dist/scripts/importLegacyMasterData.js drivers  motoristas.csv [--dry-run]
 *
 * Ordem: pessoas → veículos (o proprietário é ligado pela pessoa) → motoristas. Idempotente: rodar de
 * novo só preenche lacunas; nunca sobrescreve campo já preenchido no TSM. Sempre rode --dry-run antes
 * e assine o CSV de conferência (contagens por resultado + motivo de cada recusa).
 */
import { readFile, writeFile } from 'node:fs/promises';
import prisma from '../lib/prisma.js';
import { parseCsv } from '../services/legacyImport/csv.js';
import { importMasterData, type MasterDataKind } from '../services/legacyImport/importMasterData.js';

const KINDS: MasterDataKind[] = ['persons', 'vehicles', 'drivers'];
const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

async function main() {
    const [kind, file] = process.argv.slice(2);
    if (!KINDS.includes(kind as MasterDataKind) || !file) {
        throw new Error(`uso: importLegacyMasterData.js ${KINDS.join('|')} arquivo.csv [--dry-run] [--report saida.csv]`);
    }
    const dryRun = process.argv.includes('--dry-run');
    const i = process.argv.indexOf('--report');
    const report = i >= 0 ? process.argv[i + 1] : `import-${kind}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;

    let text = await readFile(file, 'utf8');
    // Export em ISO-8859-1 (comum no legado): sem acentos válidos em UTF-8, relê como latin1.
    if (text.includes('�')) text = (await readFile(file)).toString('latin1');
    const rows = parseCsv(text);
    const outcomes = await importMasterData(kind as MasterDataKind, rows, { dryRun });

    const counts = outcomes.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.result]: (acc[o.result] ?? 0) + 1 }), {});
    await writeFile(report, ['linha,resultado,chave,detalhe', ...outcomes.map((o) => [o.line, o.result, csv(o.key), csv(o.detail)].join(','))].join('\n') + '\n', 'utf8');
    console.log(`${dryRun ? '[dry-run] ' : ''}${kind}: ${rows.length} linhas`);
    for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`);
    console.log(`relatório de conferência: ${report}`);
}

main()
    .catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
