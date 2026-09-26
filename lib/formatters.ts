/**
 * Formatação compartilhada para o sistema TSM EX
 */

export function digitsOnly(v: string): string {
  return v.replace(/\D/g, '');
}

export function maskCPF(v: string): string {
  const d = digitsOnly(v);
  if (d.length > 11) return maskCPF(d.slice(0, 11));
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function maskCNPJ(v: string): string {
  const d = digitsOnly(v);
  if (d.length > 14) return maskCNPJ(d.slice(0, 14));
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/** Formata como CPF ou CNPJ conforme quantidade de dígitos */
export function maskCNPJOrCPF(v: string): string {
  const d = digitsOnly(v);
  if (d.length <= 11) return maskCPF(v);
  return maskCNPJ(v);
}

export function isCPF(v: string): boolean {
  return digitsOnly(v).length === 11;
}

export function isCNPJ(v: string): boolean {
  return digitsOnly(v).length === 14;
}

export function isValidCPF(v: string): boolean {
  const d = digitsOnly(v);
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (const size of [9, 10]) {
    const sum = [...d.slice(0, size)].reduce((total, digit, index) => total + Number(digit) * (size + 1 - index), 0);
    const check = (sum * 10) % 11;
    if (Number(d[size]) !== (check === 10 ? 0 : check)) return false;
  }
  return true;
}

export function isValidCNPJ(v: string): boolean {
  const d = digitsOnly(v);
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  for (const weights of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const sum = weights.reduce((total, weight, index) => total + Number(d[index]) * weight, 0);
    const check = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (Number(d[weights.length]) !== check) return false;
  }
  return true;
}

/** Formata telefone: (11) 99999-9999 celular, (11) 9999-9999 fixo */
export function maskPhone(v: string): string {
  const d = digitsOnly(v).slice(0, 11);
  if (d.length <= 2) {
    return d.length ? `(${d}` : '';
  }
  if (d.length <= 6) {
    return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  }
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Máscara para input DD/MM/YYYY */
export function maskDateDDMMYYYY(v: string): string {
  const d = digitsOnly(v).slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** Converte string DD/MM/YYYY em YYYY-MM-DD ou null */
export function parseDateDDMMYYYY(v: string): string | null {
  if (!v || typeof v !== 'string') return null;
  const d = digitsOnly(v);
  if (d.length !== 8) return null;
  const day = d.slice(0, 2);
  const month = d.slice(2, 4);
  const year = d.slice(4, 8);
  const dayN = parseInt(day, 10);
  const monthN = parseInt(month, 10);
  if (dayN < 1 || dayN > 31) return null;
  if (monthN < 1 || monthN > 12) return null;
  return `${year}-${month}-${day}`;
}

/** Formata Date ou string ISO para exibição DD/MM/YYYY */
export function formatDateToDDMMYYYY(d: Date | string | null | undefined): string {
  if (!d) return '';
  try {
    const date = typeof d === 'string' ? new Date(d) : d;
    if (isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return '';
  }
}
