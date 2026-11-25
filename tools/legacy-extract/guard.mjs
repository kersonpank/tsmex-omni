/**
 * Guarda do extrator: o sistema legado usa GET com efeito colateral (gerar pedido da NF-e, enviar
 * boleto por e-mail, importar NF-e da SEFAZ são GETs). Por isso a regra é LISTA FECHADA:
 * 1. só a origem configurada;
 * 2. só caminhos declarados nos jobs (o resto é recusado);
 * 3. nenhum caminho ou nome de parâmetro com palavra de ação — checado ao carregar a configuração e
 *    de novo em cada requisição.
 */
export const ACTION_WORDS = [
  'emit', 'cancel', 'exclu', 'delet', 'remov', 'apaga', 'import', 'salva', 'grava', 'encerra',
  'envia', 'enviar', 'send', 'mail', 'transmit', 'logout', 'gera_', 'gerar', 'insert', 'insere',
  'altera', 'liquida', 'estorn', 'baixa_titulo', 'baixar_titulo', 'quita', 'aprova', 'reprova',
  'inutiliz', 'autoriz', 'averba', 'manifesta', 'sincroniza', 'processa', 'executa', 'criar',
];

/** Parâmetros que em sistemas PHP costumam carregar a AÇÃO no valor (?acao=excluir). */
const CONTROL_PARAMS = /^(acao|op|oper|operacao|action|act|cmd|comando|metodo|method|funcao|func|tarefa|task|modo|mode)$/i;

const ACTION_RE = new RegExp(`(${ACTION_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');

/** Encontra palavra de ação no caminho ou nos NOMES dos parâmetros (valores, como datas, não contam). */
export function actionWordIn(url, allowedWords = []) {
  const u = new URL(url);
  const parts = [decodeURIComponent(u.pathname), ...[...u.searchParams.keys()]];
  for (const [k, v] of u.searchParams) if (CONTROL_PARAMS.test(k)) parts.push(`${k}=${v}`);
  for (const p of parts) {
    const re = new RegExp(ACTION_RE.source, 'gi');
    let m;
    while ((m = re.exec(p))) {
      if (!allowedWords.includes(m[1].toLowerCase())) return { part: p, word: m[1] };
    }
  }
  return null;
}

/** Converte o caminho do job ("/rota/{id}/itens") numa expressão exata (cada {x} = um segmento). */
export function pathPattern(template) {
  const escaped = template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[a-zA-Z_]+\}/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

export class GuardError extends Error {}

/**
 * Exceção revisada por gente: um job cujo caminho tem palavra de ação mas que foi conferido como
 * só leitura (ex.: download de XML em lote chamado "gera_zip"). Exige o motivo por escrito.
 * Formato: "reviewedReadOnly": { "words": ["gera_"], "reason": "baixa o zip dos XML; não grava nada" }
 */
function reviewedWords(job) {
  const r = job.reviewedReadOnly;
  if (!r) return [];
  if (!Array.isArray(r.words) || !r.reason || String(r.reason).trim().length < 10) {
    throw new GuardError(`Job "${job.name}": reviewedReadOnly precisa de "words" e de um "reason" explicando por que é só leitura.`);
  }
  return r.words.map((w) => String(w).toLowerCase());
}

export function createGuard(config) {
  const origin = new URL(config.baseUrl).origin;
  const allowed = config.jobs.map((j) => ({ name: j.name, re: pathPattern(j.path), words: reviewedWords(j) }));
  for (const job of config.jobs) {
    const sample = new URL(job.path.replace(/\{[a-zA-Z_]+\}/g, 'x'), origin);
    for (const [k, v] of Object.entries(job.query ?? {})) sample.searchParams.set(k, String(v));
    const hit = actionWordIn(sample.toString(), reviewedWords(job));
    if (hit) throw new GuardError(`Job "${job.name}" recusado: "${hit.part}" tem a palavra de ação "${hit.word}". O extrator só lê (se foi conferido que é só leitura, declare reviewedReadOnly com o motivo).`);
  }
  return {
    check(url, method = 'GET') {
      if (method !== 'GET') throw new GuardError(`Só GET é permitido (pedido: ${method}).`);
      const u = new URL(url);
      if (u.origin !== origin) throw new GuardError(`Origem fora da configuração: ${u.origin}`);
      const job = allowed.find((a) => a.re.test(u.pathname));
      if (!job) throw new GuardError(`Caminho fora da lista fechada: ${u.pathname}`);
      const hit = actionWordIn(url, job.words);
      if (hit) throw new GuardError(`Bloqueado: "${hit.part}" tem a palavra de ação "${hit.word}".`);
      return job.name;
    },
  };
}
