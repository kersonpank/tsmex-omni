#!/usr/bin/env node
/**
 * Rascunho da configuração do extrator a partir de um HAR da navegação no sistema legado (a captura
 * só de leitura de out/2026 em research/legado/, ou uma nova: DevTools → Network → "Save all as HAR").
 *
 *   node tools/legacy-extract/har-to-config.mjs captura.har > legado.config.json
 *
 * Lista os GET que devolveram JSON/CSV/XML/ZIP, junta por caminho (ids numéricos viram {id}) e
 * DESCARTA tudo com palavra de ação (vão para "descartados", para conferência). O resultado é um
 * rascunho: revise cada job (nome, listPath, paginação, divisão por mês) antes de rodar.
 */
import { readFile } from 'node:fs/promises';
import { actionWordIn } from './guard.mjs';

const KIND = [
  [/json/i, 'json'],
  [/csv|text\/plain/i, 'csv'],
  [/xml/i, 'file'],
  [/zip|octet-stream|pdf/i, 'file'],
];

export function harToConfig(har) {
  const entries = har?.log?.entries ?? [];
  const jobs = new Map();
  const discarded = new Map();
  let origin = null;
  for (const e of entries) {
    const req = e.request ?? {};
    let u;
    try { u = new URL(req.url); } catch { continue; }
    if (req.method !== 'GET' || !/^https?:$/.test(u.protocol)) continue;
    const type = e.response?.content?.mimeType ?? '';
    const kind = KIND.find(([re]) => re.test(type))?.[1];
    if (!kind || /\.(js|css|png|jpe?g|svg|woff2?|ico|html?)$/i.test(u.pathname)) continue;
    const templ = u.pathname.replace(/\/\d+(?=\/|$)/g, '/{id}');
    const hit = actionWordIn(u.toString());
    if (hit) { discarded.set(templ, `palavra de ação "${hit.word}" em ${hit.part}`); continue; }
    origin ??= u.origin;
    if (u.origin !== origin) continue;
    const prev = jobs.get(templ);
    const query = Object.fromEntries([...u.searchParams.keys()].map((k) => [k, u.searchParams.get(k)]));
    const size = e.response?.content?.size ?? 0;
    if (!prev || size > prev._size) {
      const name = templ.split('/').filter((p) => p && p !== '{id}').slice(-2).join('_').replace(/[^a-z0-9_]/gi, '_').toLowerCase() || 'raiz';
      jobs.set(templ, {
        name,
        path: templ,
        format: kind,
        ...(kind === 'file' ? { ext: /zip/i.test(type) ? 'zip' : /pdf/i.test(type) ? 'pdf' : 'xml' } : {}),
        query,
        listPath: '',
        _size: size,
        _note: 'REVISAR: listPath (onde está a lista no JSON), paginate.param, split por mês ({inicio}/{fim}) ou por id',
      });
    }
  }
  const names = new Set();
  const list = [...jobs.values()].map(({ _size, ...j }) => {
    let n = j.name;
    for (let i = 2; names.has(n); i++) n = `${j.name}_${i}`;
    names.add(n);
    return { ...j, name: n };
  });
  return {
    baseUrl: origin ?? 'https://COLOQUE-A-URL-DO-LEGADO',
    outDir: '../research/legado/extract',
    delayMs: 1500,
    jobs: list,
    descartados: Object.fromEntries(discarded),
  };
}

if (process.argv[1]?.endsWith('har-to-config.mjs')) {
  const file = process.argv[2];
  if (!file) { console.error('uso: har-to-config.mjs captura.har > legado.config.json'); process.exit(2); }
  const har = JSON.parse(await readFile(file, 'utf8'));
  process.stdout.write(JSON.stringify(harToConfig(har), null, 2) + '\n');
}
