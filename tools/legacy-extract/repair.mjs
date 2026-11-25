/**
 * Leitura tolerante das respostas do sistema legado: PHP em ISO-8859-1 que às vezes deixa passar
 * caractere de controle cru e ASPAS SEM ESCAPE dentro de string (o JSON é montado por concatenação:
 * um nome com aspas vira `"nome": "ACME "MATRIZ""`). Converte para texto (UTF-8, ou latin1 quando não
 * for UTF-8 válido), escapa os controles e as aspas internas (aspa que não é seguida de estrutura de
 * JSON). Não inventa dado: se ainda assim não for JSON, quem chama recebe o erro.
 */
export function decodeLegacyText(buf) {
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

/** Depois de uma aspa, o que vem é estrutura de JSON (então a aspa fecha a string)? */
function closesString(text, from) {
  let j = from;
  while (j < text.length && /\s/.test(text[j])) j++;
  if (j >= text.length) return true;
  const c = text[j];
  if (c === '}' || c === ']' || c === ':') return true;
  if (c !== ',') return false;
  // Vírgula só é estrutura se depois dela vier o começo de um valor/chave.
  let k = j + 1;
  while (k < text.length && /\s/.test(text[k])) k++;
  return k >= text.length || /["{\[\d\-tfn]/.test(text[k]);
}

export function repairLegacyJson(input) {
  const text = Buffer.isBuffer(input) ? decodeLegacyText(input) : String(input);
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if (inString) {
      if (escaped) { escaped = false; out += ch; continue; }
      if (ch === '\\') { escaped = true; out += ch; continue; }
      if (ch === '"') {
        if (closesString(text, i + 1)) { inString = false; out += ch; } else out += '\\"';
        continue;
      }
      if (code < 0x20) { out += code === 10 ? '\\n' : code === 13 ? '\\r' : code === 9 ? '\\t' : `\\u${code.toString(16).padStart(4, '0')}`; continue; }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}
