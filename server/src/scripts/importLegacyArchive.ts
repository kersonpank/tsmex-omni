/**
 * Carga do ARQUIVO do sistema legado (histórico completo, como veio) a partir dos exports dele.
 *
 *   node dist/scripts/importLegacyArchive.js <tipo> <arquivo-ou-pasta> [--key coluna|a+b] [--meta-key totregs] [--id-from-filename campo] [--collection caminho.no.json] [--format csv|json]
 *
 * Exemplos:
 *   importLegacyArchive.js pedidos  ./export/pedidos/          (todos os .csv/.json da pasta)
 *   importLegacyArchive.js titulos  ./titulos-2024.csv --key numero
 *   importLegacyArchive.js viagens  ./extract/viagens --collection dados.lista
 *
 * Idempotente: rodar de novo não duplica; linha que mudou no legado atualiza e conta revisão.
 * Arquivos em ISO-8859-1 (comum no legado) são relidos como latin1 automaticamente.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import prisma from '../lib/prisma.js';
import { archiveLegacyRows, legacyArchiveSummary, parseLegacyExport } from '../services/legacyImport/legacyArchive.js';

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function filesOf(target: string): Promise<string[]> {
    if (!(await stat(target)).isDirectory()) return [target];
    const out: string[] = [];
    for (const e of await readdir(target, { withFileTypes: true })) {
        const full = path.join(target, e.name);
        if (e.isDirectory()) out.push(...(await filesOf(full)));
        else if (/\.(csv|json|jsonl|txt)$/i.test(e.name)) out.push(full);
    }
    return out.sort();
}

async function main() {
    const [entity, target] = process.argv.slice(2);
    if (!entity || !target || entity.startsWith('--')) throw new Error('uso: importLegacyArchive.js <tipo> <arquivo-ou-pasta> [--key coluna] [--collection caminho] [--format csv|json]');
    const format = arg('--format') as 'csv' | 'json' | undefined;
    const totals = { created: 0, updated: 0, unchanged: 0, total: 0 };
    for (const file of await filesOf(target)) {
        let text = await readFile(file, 'utf8');
        if (text.includes('�')) text = (await readFile(file)).toString('latin1');
        let rows = parseLegacyExport(text, { format, collection: arg('--collection') ?? null });
        // Detalhe baixado por id (ex.: MDF-e da viagem 14622 → id-14622.json): grava o id de origem em
        // cada linha, senão a linha perde a ligação com a viagem/pedido a que pertence.
        const idField = arg('--id-from-filename');
        const idMatch = /(?:^|[-_])id-(.+)\.[a-z]+$/i.exec(path.basename(file)) ?? /^id-(.+)\.[a-z]+$/i.exec(path.basename(file));
        if (idField && idMatch) rows = rows.map((r) => ({ [idField]: idMatch[1], ...r }));
        if (rows.length === 0) { console.log(`  ${path.basename(file)}: vazio`); continue; }
        const r = await archiveLegacyRows(entity, rows, { keyColumn: arg('--key') ?? null, sourceFile: path.basename(file), metaKey: arg('--meta-key') ?? null });
        console.log(`  ${path.basename(file)}: ${r.total} linhas → ${r.created} novas, ${r.updated} alteradas, ${r.unchanged} iguais (chave: ${r.keyColumn ?? 'hash da linha'})`);
        for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += r[k];
    }
    console.log(`total ${entity}: ${totals.total} linhas → ${totals.created} novas, ${totals.updated} alteradas, ${totals.unchanged} iguais`);
    console.log('arquivo do legado agora:');
    for (const s of await legacyArchiveSummary()) console.log(`  ${s.entity}: ${s.count}`);
}

main()
    .catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
