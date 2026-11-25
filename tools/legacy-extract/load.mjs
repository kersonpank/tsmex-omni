#!/usr/bin/env node
/**
 * Carrega no TSM tudo que o extrator baixou:
 * - listagens e detalhes → Histórico do legado (`importLegacyArchive`), com a chave de cada job
 *   (`archiveKey`, pode ser composta), sem a linha de totais (`metaKey`) e, nos detalhes baixados por id,
 *   com o id de origem gravado em cada linha (`archiveIdField`, ex.: viagem_numero);
 * - ZIPs de XML (job com `ext: "zip"`) → extraídos e enviados ao arquivo fiscal externo (`importExternalFiscal`).
 *
 *   node tools/legacy-extract/load.mjs --config legado.config.json [--only pedidos,ctes] [--scripts server/dist/scripts]
 *
 * Usa DATABASE_URL do ambiente. Idempotente. Chave que não é única num arquivo → o importador recusa.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './extract.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const config = await loadConfig(opt('--config', 'legado.config.json'));
const only = opt('--only')?.split(',');
const scripts = path.resolve(opt('--scripts', 'server/dist/scripts'));
const runScript = (name, argv) => {
  const js = path.join(scripts, `${name}.js`);
  const ts = path.join(scripts, `${name}.ts`);
  const [cmd, pre] = existsSync(js) ? ['node', [js]] : ['npx', ['tsx', ts]];
  return spawnSync(cmd, [...pre, ...argv], { stdio: 'inherit' }).status;
};

let failed = 0;
for (const job of config.jobs) {
  if (only && !only.includes(job.name)) continue;
  const dir = path.join(config.outDir, job.name);
  if (!existsSync(dir)) { console.log(`- ${job.name}: nada baixado`); continue; }
  console.log(`▶ ${job.name}`);
  if (job.ext === 'zip') {
    const xmlDir = path.join(dir, '_xml');
    mkdirSync(xmlDir, { recursive: true });
    for (const zip of readdirSync(dir).filter((f) => f.endsWith('.zip'))) {
      const full = path.join(dir, zip);
      if (statSync(full).size === 0) continue; // emitente sem movimento no mês
      const r = spawnSync('unzip', ['-q', '-o', full, '-d', path.join(xmlDir, zip.replace(/\.zip$/, ''))], { stdio: 'inherit' });
      if (r.status !== 0) { console.error(`  zip ilegível: ${zip}`); failed++; }
    }
    if (runScript('importExternalFiscal', [xmlDir, '--note', `legado ${job.name}`, '--report', path.join(dir, 'conferencia-fiscal.csv')]) !== 0) failed++;
    continue;
  }
  const extra = [
    ...(job.archiveKey ? ['--key', job.archiveKey] : []),
    ...(job.metaKey ? ['--meta-key', job.metaKey] : []),
    ...(job.archiveIdField ? ['--id-from-filename', job.archiveIdField] : []),
  ];
  if (runScript('importLegacyArchive', [job.name, dir, ...extra]) !== 0) failed++;
}
if (failed) { console.error(`${failed} etapa(s) não carregaram — veja as mensagens acima.`); process.exitCode = 1; }
