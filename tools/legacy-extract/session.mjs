/**
 * Sessão no sistema legado sem navegador: cookie guardado num arquivo de sessão local (fora do git)
 * e login automático pelo formulário do próprio sistema, com usuário e senha SÓ de variáveis de
 * ambiente (LEGADO_USUARIO / LEGADO_SENHA). Nada de credencial em arquivo.
 *
 * config.login = {
 *   "page": "/mobile/",                      página que entrega o token do formulário e o cookie
 *   "tokenRegex": "js_p455='([^']*)",        de onde tirar o token (grupo 1)
 *   "path": "/mobile/login2021.php",         POST JSON { usuario, senha, <tokenField> }
 *   "tokenField": "p455", "userField": "usuario", "passwordField": "senha",
 *   "okField": "erro", "okValue": "0"        resposta de sucesso
 * }
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function mergeCookies(jar, setCookies) {
  for (const raw of setCookies) {
    const kv = String(raw).split(';')[0];
    const i = kv.indexOf('=');
    if (i <= 0) continue;
    const name = kv.slice(0, i).trim();
    const value = kv.slice(i + 1).trim();
    if (!value || value === 'deleted') delete jar[name];
    else jar[name] = value;
  }
  return jar;
}

const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const setCookiesOf = (res) => (typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean));

export async function loginWithForm(config, env = process.env, fetchImpl = fetch) {
  const l = config.login;
  if (!l?.path || !l?.page) throw new Error('config.login (page, path) não definido.');
  const user = env.LEGADO_USUARIO;
  const pass = env.LEGADO_SENHA;
  if (!user || !pass) throw new Error('Defina LEGADO_USUARIO e LEGADO_SENHA no ambiente (nunca em arquivo).');
  const jar = {};
  const page = await fetchImpl(new URL(l.page, config.baseUrl), { redirect: 'manual' });
  mergeCookies(jar, setCookiesOf(page));
  const html = await page.text();
  const token = l.tokenRegex ? (new RegExp(l.tokenRegex).exec(html)?.[1] ?? '') : '';
  const body = { [l.userField ?? 'usuario']: user, [l.passwordField ?? 'senha']: pass, ...(l.tokenField ? { [l.tokenField]: token } : {}) };
  const res = await fetchImpl(new URL(l.path, config.baseUrl), {
    method: 'POST', // o ÚNICO POST do extrator: o formulário de login, em endereço fixo da configuração
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(jar) },
    body: JSON.stringify(body),
  });
  mergeCookies(jar, setCookiesOf(res));
  let parsed = {};
  try { parsed = JSON.parse(await res.text()); } catch { /* resposta não-JSON = falha */ }
  if (String(parsed?.[l.okField ?? 'erro']) !== String(l.okValue ?? '0')) {
    throw new Error(`Login recusado pelo sistema legado: ${parsed?.mensagem ?? `HTTP ${res.status}`}`);
  }
  await mkdir(path.dirname(config.sessionFile), { recursive: true });
  await writeFile(config.sessionFile, JSON.stringify({ cookies: jar, at: new Date().toISOString() }), { mode: 0o600 });
  return jar;
}

/** Contexto de requisição (mesma interface usada pelo executor) com o cookie da sessão salva. */
export async function cookieContext(config, fetchImpl = fetch) {
  if (!existsSync(config.sessionFile)) throw new Error('Sem sessão salva. Rode "login" (navegador) ou "login-auto" (variáveis de ambiente).');
  let jar = JSON.parse(await readFile(config.sessionFile, 'utf8')).cookies ?? {};
  return {
    async get(url, opts = {}) {
      const res = await fetchImpl(url, { redirect: 'manual', headers: { Cookie: cookieHeader(jar), 'X-Requested-With': 'XMLHttpRequest' }, signal: AbortSignal.timeout(opts.timeout ?? 120_000) });
      jar = mergeCookies(jar, setCookiesOf(res));
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: () => res.status, body: async () => buf, headers: () => Object.fromEntries(res.headers) };
    },
    async dispose() {},
    reload: async () => { jar = JSON.parse(await readFile(config.sessionFile, 'utf8')).cookies ?? {}; },
  };
}
