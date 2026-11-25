import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { actionWordIn, createGuard, GuardError } from './guard.mjs';
import { expandJob, monthsBetween } from './plan.mjs';
import { run } from './extract.mjs';

test('guarda: lista fechada, só GET, palavras de ação no caminho, no nome e no valor de controle', () => {
  const guard = createGuard({ baseUrl: 'https://legado.test', jobs: [{ name: 'pessoas', path: '/api/pessoas/lista' }, { name: 'viagem', path: '/api/viagens/{id}' }] });
  assert.equal(guard.check('https://legado.test/api/pessoas/lista?pagina=2'), 'pessoas');
  assert.equal(guard.check('https://legado.test/api/viagens/123'), 'viagem');
  assert.throws(() => guard.check('https://legado.test/api/pessoas/lista', 'POST'), GuardError);
  assert.throws(() => guard.check('https://outro.test/api/pessoas/lista'), /Origem/);
  assert.throws(() => guard.check('https://legado.test/api/pedidos/lista'), /fora da lista fechada/);
  assert.throws(() => guard.check('https://legado.test/api/pessoas/lista?acao=excluir'), /exclu/);
  assert.equal(actionWordIn('https://x.test/api/postos?dt_criacao=1&renovacao=2'), null);
  assert.ok(actionWordIn('https://x.test/api/nfe/gera_pedido'));
  assert.throws(() => createGuard({ baseUrl: 'https://l.test', jobs: [{ name: 'x', path: '/api/cte/cancelar' }] }), /recusado/);
  assert.throws(() => createGuard({ baseUrl: 'https://l.test', jobs: [{ name: 'x', path: '/api/xml/gera_zip', reviewedReadOnly: { words: ['gera_'] } }] }), /reason/);
  const reviewed = createGuard({ baseUrl: 'https://l.test', jobs: [{ name: 'xml', path: '/api/xml/gera_zip', reviewedReadOnly: { words: ['gera_'], reason: 'só baixa o zip dos XML do mês' } }] });
  assert.equal(reviewed.check('https://l.test/api/xml/gera_zip?mes=1'), 'xml');
});

test('plano: um pedido por mês com datas BR ou ISO', () => {
  assert.equal(monthsBetween('2025-11', '2026-02').length, 4);
  const units = expandJob({ name: 'ctes', path: '/api/cte', query: { de: '{inicio}', ate: '{fim}' }, split: { type: 'months', from: '2024-02', to: '2024-02' } });
  assert.deepEqual(units, [{ key: '2024-02', path: '/api/cte', query: { de: '01/02/2024', ate: '29/02/2024' } }]);
});

test('executor: pagina até vazio, mês a mês, detalhe por id, retoma sem rebaixar e para quando a sessão vence', async () => {
  let calls = [];
  let sessionValid = true;
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    calls.push(u.pathname + u.search);
    if (req.method !== 'GET') { res.writeHead(500); return res.end(); }
    if (!sessionValid) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>login</html>'); }
    res.setHeader('content-type', 'application/json');
    if (u.pathname === '/api/viagens') {
      const p = Number(u.searchParams.get('pagina'));
      return res.end(JSON.stringify({ total: 3, dados: p === 1 ? [{ id: 7 }, { id: 8 }] : p === 2 ? [{ id: 9 }] : [] }));
    }
    if (u.pathname.startsWith('/api/viagens/')) return res.end(JSON.stringify({ id: u.pathname.split('/').pop(), itens: [] }));
    if (u.pathname === '/api/cte') {
      // O servidor tem de receber a data e o filtro JSON exatamente como o legado espera (sem dupla codificação).
      if (!/^2026-0[1-3]-01$/.test(u.searchParams.get('de') ?? '') || u.searchParams.get('rota') !== '{"codigo":"*"}') { res.writeHead(400); return res.end('parametro'); }
      return res.end(JSON.stringify({ lista: [{ chave: u.searchParams.get('de') }] }));
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'legado-'));
  const contextFactory = async () => ({
    get: async (url) => { const r = await fetch(url, { redirect: 'manual' }); const buf = Buffer.from(await r.arrayBuffer()); return { status: () => r.status, body: async () => buf, headers: () => Object.fromEntries(r.headers) }; },
    dispose: async () => {},
  });
  const quiet = { log: () => {}, warn: () => {} };
  const config = {
    baseUrl, outDir, delayMs: 0, maxPages: 50,
    jobs: [
      { name: 'viagens', path: '/api/viagens', format: 'json', listPath: 'dados', paginate: { param: 'pagina', start: 1 } },
      { name: 'viagem_detalhe', path: '/api/viagens/{id}', format: 'json', split: { type: 'ids', fromJob: 'viagens', listPath: 'dados', idField: 'id' } },
      { name: 'ctes', path: '/api/cte', format: 'json', listPath: 'lista', query: { de: '{inicio}', ate: '{fim}', rota: '{"codigo":"*"}' }, split: { type: 'months', from: '2026-01', to: '2026-03', dateFormat: 'iso' } },
    ],
  };
  try {
    await run(config, { contextFactory, out: quiet });
    assert.deepEqual((await readdir(path.join(outDir, 'viagens'))).sort(), ['all-p1.json', 'all-p2.json']);
    assert.deepEqual((await readdir(path.join(outDir, 'viagem_detalhe'))).sort(), ['id-7.json', 'id-8.json', 'id-9.json']);
    assert.equal((await readdir(path.join(outDir, 'ctes'))).length, 3);
    const manifest = (await readFile(path.join(outDir, 'manifest.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(manifest.filter((m) => m.ok && !m.empty).every((m) => /^[0-9a-f]{64}$/.test(m.sha256)));

    calls = [];
    await run(config, { contextFactory, out: quiet }); // retomada: só a página vazia é consultada de novo
    assert.deepEqual(calls, ['/api/viagens?pagina=3']);

    sessionValid = false;
    await rm(path.join(outDir, 'ctes'), { recursive: true });
    await assert.rejects(() => run({ ...config, jobs: [{ ...config.jobs[2], name: 'ctes2' }] }, { contextFactory, out: quiet }), /Sessão expirada/);
  } finally {
    server.close();
    await rm(outDir, { recursive: true, force: true });
  }
});

test('HAR → rascunho de configuração: junta por caminho, ids viram {id}, descarta ações e estáticos', async () => {
  const { harToConfig } = await import('./har-to-config.mjs');
  const entry = (method, url, mimeType, size = 10) => ({ request: { method, url }, response: { content: { mimeType, size } } });
  const config = harToConfig({ log: { entries: [
    entry('GET', 'https://legado.test/api/pessoas?pagina=1', 'application/json', 100),
    entry('GET', 'https://legado.test/api/pessoas?pagina=2', 'application/json', 900),
    entry('GET', 'https://legado.test/api/viagens/123/itens', 'application/json'),
    entry('GET', 'https://legado.test/api/viagens/456/itens', 'application/json'),
    entry('GET', 'https://legado.test/api/nfe/gera_pedido?chave=1', 'application/json'),
    entry('GET', 'https://legado.test/app/main.js', 'application/javascript'),
    entry('POST', 'https://legado.test/api/login', 'application/json'),
    entry('GET', 'https://legado.test/api/cte/xml_lote?mes=10', 'application/zip'),
  ] } });
  assert.equal(config.baseUrl, 'https://legado.test');
  assert.deepEqual(config.jobs.map((j) => j.path), ['/api/pessoas', '/api/viagens/{id}/itens', '/api/cte/xml_lote']);
  assert.deepEqual(config.jobs[0].query, { pagina: '2' });
  assert.equal(config.jobs[2].ext, 'zip');
  assert.ok(config.descartados['/api/nfe/gera_pedido']);
  createGuard(config); // o rascunho já passa na guarda
});

test('login automático pelo formulário e reentrada quando o legado responde "sessão expirou" com HTTP 200', async () => {
  const { loginWithForm } = await import('./session.mjs');
  let validSession = null;
  let logins = 0;
  let served = 0;
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const cookie = req.headers.cookie ?? '';
    if (u.pathname === '/mobile/' && req.method === 'GET') {
      res.setHeader('set-cookie', 'PHPSESSID=s' + (logins + 1) + '; path=/');
      return res.end("<script>var js_p455='TOK123';</script>");
    }
    if (u.pathname === '/mobile/login2021.php' && req.method === 'POST') {
      let raw = ''; for await (const c of req) raw += c;
      const b = JSON.parse(raw);
      if (b.usuario !== 'op@tsm' || b.senha !== 'segredo' || b.p455 !== 'TOK123' || !cookie.includes('PHPSESSID=')) { res.end(JSON.stringify({ erro: '1', mensagem: 'inválido' })); return; }
      logins++; validSession = cookie.match(/PHPSESSID=([^;]+)/)[1];
      return res.end(JSON.stringify({ erro: '0' }));
    }
    if (u.pathname === '/mobile/pedidos/json/lista_pedidos.php') {
      res.setHeader('content-type', 'application/json');
      if (!validSession || !cookie.includes(`PHPSESSID=${validSession}`)) return res.end(JSON.stringify([{ nome: 'Sua sessão expirou' }]));
      served++;
      if (served === 1) validSession = null; // a sessão cai depois do primeiro mês
      return res.end(JSON.stringify([{ codigo: served, totregs: 1 }]));
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'legado-login-'));
  const config = {
    baseUrl, outDir, sessionFile: path.join(outDir, '.session.json'), delayMs: 0, maxPages: 5, expiredPattern: '"nome"\\s*:\\s*"[^"]*expirou',
    login: { page: '/mobile/', tokenRegex: "js_p455='([^']*)", path: '/mobile/login2021.php', tokenField: 'p455', okField: 'erro', okValue: '0' },
    jobs: [{ name: 'pedidos', path: '/mobile/pedidos/json/lista_pedidos.php', format: 'json', listPath: '', query: { data1: '{inicio}', data2: '{fim}' }, split: { type: 'months', from: '2026-01', to: '2026-02' } }],
  };
  const env = { LEGADO_USUARIO: 'op@tsm', LEGADO_SENHA: 'segredo' };
  const quiet = { log: () => {}, warn: () => {} };
  try {
    await assert.rejects(() => loginWithForm(config, { LEGADO_USUARIO: 'op@tsm', LEGADO_SENHA: 'errada' }), /recusado/);
    await assert.rejects(() => loginWithForm(config, {}), /LEGADO_USUARIO/);
    await loginWithForm(config, env);
    assert.ok(!(await readFile(config.sessionFile, 'utf8')).includes('segredo'));
    await run(config, { out: quiet, relogin: () => loginWithForm(config, env) });
    assert.deepEqual((await readdir(path.join(outDir, 'pedidos'))).sort(), ['2026-01.json', '2026-02.json']);
    assert.equal(logins, 2);
    // Sem login automático, a sessão vencida para a execução com aviso claro.
    validSession = null;
    await assert.rejects(() => run({ ...config, jobs: [{ ...config.jobs[0], name: 'pedidos2' }] }, { out: quiet }), /Sessão expirada/);
  } finally {
    server.close();
    await rm(outDir, { recursive: true, force: true });
  }
});
