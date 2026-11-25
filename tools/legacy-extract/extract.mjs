#!/usr/bin/env node
/**
 * Extrator SÓ DE LEITURA do sistema legado — leva o histórico da TransMesquita para o TSM.
 * Roda na máquina da empresa, com o login da própria empresa. Nada de senha em arquivo.
 *
 *   node tools/legacy-extract/extract.mjs login  --config legado.config.json   (abre o navegador; você entra; a sessão fica salva)
 *   LEGADO_USUARIO=… LEGADO_SENHA=… node tools/legacy-extract/extract.mjs login-auto --config legado.config.json   (servidor, sem navegador)
 *   node tools/legacy-extract/extract.mjs run    --config legado.config.json [--only pessoas,viagens]
 *   node tools/legacy-extract/extract.mjs status --config legado.config.json
 *
 * Saída em `outDir` (fora do git: contém dado pessoal): um arquivo por mês/página/id + manifest.jsonl
 * com sha256 de cada arquivo. Retomável: o que já baixou com sucesso não baixa de novo.
 * Depois: server/dist/scripts/importLegacyArchive.js e importExternalFiscal.js carregam no TSM.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { createGuard, GuardError } from './guard.mjs';
import { expandJob } from './plan.mjs';
import { cookieContext, loginWithForm } from './session.mjs';
import { repairLegacyJson } from './repair.mjs';

const args = process.argv.slice(2);
const command = args[0];
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };

export async function loadConfig(file) {
  const config = JSON.parse(await readFile(file, 'utf8'));
  if (!config.baseUrl || !Array.isArray(config.jobs) || config.jobs.length === 0) throw new Error('Configuração precisa de baseUrl e jobs.');
  const dir = path.dirname(path.resolve(file));
  // LEGADO_OUT_DIR (ambiente) manda: na migração pela infra a saída vai para o volume do container.
  config.outDir = path.resolve(dir, process.env.LEGADO_OUT_DIR || config.outDir || '../research/legado/extract');
  config.sessionFile = path.resolve(dir, config.sessionFile ?? path.join(config.outDir, '.session.json'));
  config.delayMs = config.delayMs ?? 1500;
  config.maxPages = config.maxPages ?? 5000;
  return config;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function getPath(obj, dotted) {
  if (!dotted) return obj;
  return dotted.split('.').reduce((n, k) => (n == null ? undefined : n[k]), obj);
}

async function readManifest(outDir) {
  const file = path.join(outDir, 'manifest.jsonl');
  if (!existsSync(file)) return [];
  return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

class SessionExpired extends Error {}

/** Baixa uma requisição concreta (com páginas, se o job pagina). */
async function fetchUnit(ctx, guard, config, job, unit, done, log, out) {
  const paged = job.paginate?.param;
  const start = job.paginate?.start ?? 1;
  let lastHash = null;
  for (let page = start; page < start + (paged ? config.maxPages : 1); page++) {
    const id = paged ? `${unit.key}-p${page}` : unit.key;
    if (done.has(`${job.name}/${id}`)) continue;
    const url = new URL(unit.path, config.baseUrl);
    for (const [k, v] of Object.entries(unit.query)) url.searchParams.set(k, v);
    if (paged) url.searchParams.set(paged, String(page));
    guard.check(url.toString(), 'GET'); // lista fechada + palavras de ação: antes de QUALQUER pedido

    let res;
    for (let attempt = 1; ; attempt++) {
      try {
        res = await ctx.get(url.toString(), { timeout: config.timeoutMs ?? 120_000, maxRedirects: 0 });
        if (res.status() >= 500 && attempt < 4) { await sleep(attempt * 5000); continue; }
        break;
      } catch (err) {
        if (attempt >= 4) throw err;
        await sleep(attempt * 5000);
      }
    }
    const status = res.status();
    const body = await res.body();
    const type = res.headers()['content-type'] ?? '';
    // Sessão vencida: o legado redireciona/devolve a tela de login (HTML) onde esperávamos dados.
    // O legado também responde 200 com uma linha "sessão expirou" dentro do JSON.
    const expiredText = config.expiredPattern && new RegExp(config.expiredPattern, 'i').test(body.subarray(0, 4000).toString('utf8'));
    if (expiredText || status === 401 || status === 403 || (status >= 300 && status < 400) || (job.format === 'json' && /text\/html/.test(type))) {
      throw new SessionExpired(`Sessão expirada ou sem permissão em ${job.name} (HTTP ${status}). Rode "login" de novo e depois "run" (continua de onde parou).`);
    }
    if (status !== 200) {
      await log({ job: job.name, id, status, ok: false, path: url.pathname });
      out.warn(`  ⚠️  ${job.name}/${id}: HTTP ${status} (anotado; siga e confira depois)`);
      break;
    }

    let items = null;
    let parseError = null;
    if (job.format === 'json') {
      // O legado às vezes devolve JSON malformado (caractere de controle/aspas de um cadastro). O arquivo
      // é guardado como veio mesmo assim; o importador repara a leitura. A paginação continua.
      let parsed = null;
      try { parsed = JSON.parse(repairLegacyJson(body)); } catch (err) { parseError = err.message.slice(0, 160); }
      const list = parsed == null ? null : getPath(parsed, job.listPath);
      // `metaKey`: linha de totais que o legado mistura aos registros (ex.: { totregs }). Não conta como item.
      items = Array.isArray(list) ? list.filter((x) => !(job.metaKey && x && typeof x === 'object' && job.metaKey in x)).length : null;
    }
    const hash = sha256(body);
    // Página repetida = o legado ignorou o parâmetro de página: para de paginar.
    if (paged && hash === lastHash) break;
    lastHash = hash;
    if (paged && items === 0) { await log({ job: job.name, id, status, ok: true, items: 0, empty: true, path: url.pathname }); break; }

    const ext = job.format === 'json' ? 'json' : job.format === 'csv' ? 'csv' : (job.ext ?? 'bin');
    const file = path.join(config.outDir, job.name, `${id}.${ext}`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    await log({ job: job.name, id, status, ok: true, bytes: body.length, sha256: hash, items, ...(parseError ? { parseError } : {}), file: path.relative(config.outDir, file), path: url.pathname });
    out.log(`  ${parseError ? '⚠️' : '✓'} ${job.name}/${id} (${body.length} bytes${items != null ? `, ${items} itens` : ''}${parseError ? `, JSON inválido: ${parseError}` : ''})`);
    await sleep(config.delayMs);
    if (!paged) break;
  }
}

/** ids para jobs de detalhe: lidos dos arquivos já baixados de outro job. */
async function idsFrom(config, split) {
  const dir = path.join(config.outDir, split.fromJob);
  if (!existsSync(dir)) throw new Error(`O job "${split.fromJob}" precisa rodar antes (ids para detalhe).`);
  const ids = new Set();
  for (const f of (await readdir(dir)).filter((n) => n.endsWith('.json'))) {
    const list = getPath(JSON.parse(await readFile(path.join(dir, f), 'utf8')), split.listPath);
    for (const item of Array.isArray(list) ? list : []) if (item?.[split.idField] != null) ids.add(String(item[split.idField]));
  }
  return [...ids];
}

export async function run(config, { only, contextFactory, out = console, relogin } = {}) {
  const guard = createGuard(config);
  await mkdir(config.outDir, { recursive: true });
  // Página vazia não conta como feita: numa nova rodada (contingência) ela pode ter ganhado registros.
  const done = new Set((await readManifest(config.outDir)).filter((e) => e.ok && !e.empty).map((e) => `${e.job}/${e.id}`));
  const log = (entry) => appendFile(path.join(config.outDir, 'manifest.jsonl'), JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n');
  const ctx = await (contextFactory ?? defaultContext)(config);
  try {
    for (const job of config.jobs) {
      if (only && !only.includes(job.name)) continue;
      out.log(`▶ ${job.name}`);
      const idSource = job.split?.type === 'ids' ? job.split : job.split?.forEachId;
      const extra = idSource ? { __ids: await idsFrom(config, idSource) } : {};
      for (const unit of expandJob(job, extra)) {
        try {
          await fetchUnit(ctx, guard, config, job, unit, done, log, out);
        } catch (err) {
          // Sessão caiu no meio: com login automático, entra de novo UMA vez e repete esta unidade.
          if (!(err instanceof SessionExpired) || !relogin) throw err;
          out.log('  🔑 sessão expirou; entrando de novo…');
          await relogin();
          await ctx.reload?.();
          await fetchUnit(ctx, guard, config, job, unit, done, log, out);
        }
      }
    }
  } finally {
    await ctx.dispose();
  }
}

async function defaultContext(config) {
  if (config.login?.path) return cookieContext(config);
  const { request } = await import('playwright');
  if (!existsSync(config.sessionFile)) throw new Error('Sem sessão salva. Rode "login" primeiro.');
  return request.newContext({ baseURL: config.baseUrl, storageState: config.sessionFile, extraHTTPHeaders: { 'X-Requested-With': 'XMLHttpRequest' } });
}

async function login(config) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(config.baseUrl);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('Entre no sistema legado na janela que abriu. Quando estiver na tela inicial, aperte Enter aqui… ');
  rl.close();
  await mkdir(path.dirname(config.sessionFile), { recursive: true });
  await context.storageState({ path: config.sessionFile });
  await browser.close();
  console.log(`Sessão salva em ${config.sessionFile} (não compartilhe: é o seu login).`);
}

async function status(config) {
  const entries = await readManifest(config.outDir);
  const by = new Map();
  for (const e of entries) {
    const s = by.get(e.job) ?? { ok: 0, fail: 0, bytes: 0, items: 0 };
    if (e.ok) { s.ok++; s.bytes += e.bytes ?? 0; s.items += e.items ?? 0; } else s.fail++;
    by.set(e.job, s);
  }
  for (const job of config.jobs) {
    const s = by.get(job.name);
    console.log(`${job.name.padEnd(24)} ${s ? `${s.ok} arquivos, ${s.items} itens, ${(s.bytes / 1e6).toFixed(1)} MB${s.fail ? `, ${s.fail} falhas` : ''}` : 'não rodou'}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('extract.mjs');
if (isMain && command) {
  const configFile = opt('--config', 'legado.config.json');
  loadConfig(configFile)
    .then((config) => {
      if (command === 'login') return login(config);
      if (command === 'login-auto') return loginWithForm(config).then(() => console.log('Sessão aberta e salva.'));
      if (command === 'run') {
        const auto = config.login?.path && process.env.LEGADO_USUARIO && process.env.LEGADO_SENHA;
        return run(config, { only: opt('--only')?.split(','), relogin: auto ? () => loginWithForm(config) : undefined });
      }
      if (command === 'status') return status(config);
      throw new Error('comandos: login | login-auto | run | status');
    })
    .catch((err) => {
      console.error(err instanceof GuardError ? `⛔ ${err.message}` : err instanceof SessionExpired ? `🔒 ${err.message}` : err.message ?? err);
      process.exitCode = 1;
    });
}
