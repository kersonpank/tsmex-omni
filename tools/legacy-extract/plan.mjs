/**
 * Expande cada job em requisições concretas:
 * - `months`: um pedido por mês entre `from` e `to` (AAAA-MM), preenchendo {inicio}/{fim} (dd/mm/aaaa
 *   ou aaaa-mm-dd conforme `dateFormat`) — exports grandes (pedidos, CT-e, financeiro) saem por mês;
 * - `page`: pagina {page} a partir de `start` até a lista vir vazia (o executor decide quando parar);
 * - `ids`: um pedido por id vindo de outro job já baixado (ex.: detalhe de cada viagem).
 */
const pad = (n) => String(n).padStart(2, '0');

export function monthsBetween(from, to) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, m = 1) : m++) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push({ key: `${y}-${pad(m)}`, y, m, last });
  }
  return out;
}

function fmt(y, m, d, format) {
  return format === 'iso' ? `${y}-${pad(m)}-${pad(d)}` : `${pad(d)}/${pad(m)}/${y}`;
}

/**
 * Preenche {variáveis}. `encode` só para segmentos de CAMINHO; valores de query vão crus porque o
 * executor monta a query com URLSearchParams (que já codifica) — codificar aqui dava %252F.
 */
export function fill(template, vars, { encode = false } = {}) {
  return String(template).replace(/\{([a-zA-Z_]+)\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`Variável {${k}} sem valor`);
    return encode ? encodeURIComponent(vars[k]) : String(vars[k]);
  });
}

/** Requisição concreta: { key, path, query } — `key` identifica o arquivo salvo e a retomada. */
export function expandJob(job, extraVars = {}) {
  const base = { ...(job.vars ?? {}), ...extraVars };
  const build = (key, vars) => ({
    key,
    path: fill(job.path, vars, { encode: true }),
    query: Object.fromEntries(Object.entries(job.query ?? {}).map(([k, v]) => [k, fill(v, vars)])),
  });
  if (job.split?.type === 'months') {
    return monthsBetween(job.split.from, job.split.to).map(({ key, y, m, last }) =>
      build(key, { ...base, inicio: fmt(y, m, 1, job.split.dateFormat), fim: fmt(y, m, last, job.split.dateFormat) }));
  }
  if (job.split?.type === 'ids') {
    return (extraVars.__ids ?? []).map((id) => build(`id-${id}`, { ...base, id }));
  }
  return [build('all', base)];
}
