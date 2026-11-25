#!/usr/bin/env node
/**
 * Carrega no TSM (Histórico do legado) tudo que o extrator baixou, job a job, com a chave de cada um
 * (`archiveKey`, pode ser composta: "codigo+documento") e a linha de totais ignorada (`metaKey`).
 *
 *   node tools/legacy-extract/load.mjs --config legado.config.json [--only pedidos,ctes] [--script server/dist/scripts/importLegacyArchive.js]
 *
 * Usa DATABASE_URL do ambiente (o mesmo do TSM). Idempotente: rodar de novo só atualiza o que mudou.
 * Se uma chave não for única num arquivo, o importador recusa — ajuste `archiveKey` e rode de novo.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './extract.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const config = await loadConfig(opt('--config', 'legado.config.json'));
const only = opt('--only')?.split(',');
const script = path.resolve(opt('--script', 'server/dist/scripts/importLegacyArchive.js'));
const runner = script.endsWith('.ts') ? ['npx', ['tsx', script]] : ['node', [script]];
let failed = 0;
for (const job of config.jobs) {
  if (only && !only.includes(job.name)) continue;
  const dir = path.join(config.outDir, job.name);
  if (!existsSync(dir)) { console.log(`- ${job.name}: nada baixado`); continue; }
  const extra = [...(job.archiveKey ? ['--key', job.archiveKey] : []), ...(job.metaKey ? ['--meta-key', job.metaKey] : [])];
  console.log(`▶ ${job.name}`);
  const r = spawnSync(runner[0], [...runner[1], job.name, dir, ...extra], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
if (failed) { console.error(`${failed} job(s) não carregaram — veja as mensagens acima.`); process.exitCode = 1; }
