/**
 * Promove o ARQUIVO do legado (LegacyRecord) para cadastros reais do TSM:
 * pessoas, clientes (Account + CNPJ/CPF), motoristas, veículos, rotas, tabelas de preço e contatos.
 *
 *   node dist/scripts/promoteLegacyArchive.js [--dry-run] [--only clientes,tarifas] [--report arquivo.csv]
 *
 * Etapas (em ordem): pessoas, clientes, motoristas, veiculos, rotas, tarifas, tabelas_clientes, contatos, vendedores.
 * Idempotente: identidade pela chave natural (CPF/CNPJ, placa); só preenche lacuna, nunca sobrescreve
 * campo já preenchido no TSM. `--dry-run` produz o relatório completo sem gravar.
 * O CSV do relatório contém CPF/CNPJ (dado pessoal): mantenha fora do git.
 */
import { writeFile } from 'node:fs/promises';
import prisma from '../lib/prisma.js';
import { formatSummary, summarize, toCsv } from '../services/legacyImport/promotion/report.js';
import { promoteLegacyArchive } from '../services/legacyImport/promotion/run.js';

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const only = arg('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
    const report = arg('--report');
    console.log(dryRun ? 'SIMULAÇÃO: nada será gravado.' : 'Promovendo o arquivo do legado para os cadastros do TSM.');
    const { outcomes, skipped } = await promoteLegacyArchive({ dryRun, only, log: (m) => console.log(m) });
    console.log(`\n${dryRun ? 'Resultado da simulação' : 'Resultado'}:`);
    console.log(formatSummary(summarize(outcomes)));
    for (const s of skipped) console.log(`${s.entity}: não promovido — ${s.reason}`);
    if (report) {
        await writeFile(report, toCsv(outcomes), 'utf8');
        console.log(`Relatório linha a linha: ${report} (contém CPF/CNPJ: não versionar)`);
    }
}

main()
    .catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
