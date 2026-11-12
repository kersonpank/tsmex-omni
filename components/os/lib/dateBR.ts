/**
 * Datas e horas do TSM O.S. — sempre dd/mm/aaaa e 24 h, em qualquer navegador (sem input nativo).
 * Valores internos seguem o formato dos inputs nativos: "AAAA-MM-DD" e "AAAA-MM-DDTHH:mm" (hora local),
 * então quem chama continua convertendo para ISO como antes.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Máscara progressiva: só dígitos → "dd/mm/aaaa" (ou "dd/mm/aaaa hh:mm"). */
export function maskDateBR(raw: string, withTime: boolean): string {
    const d = raw.replace(/\D/g, '').slice(0, withTime ? 12 : 8);
    let out = d.slice(0, 2);
    if (d.length > 2) out += `/${d.slice(2, 4)}`;
    if (d.length > 4) out += `/${d.slice(4, 8)}`;
    if (withTime && d.length > 8) out += ` ${d.slice(8, 10)}`;
    if (withTime && d.length > 10) out += `:${d.slice(10, 12)}`;
    return out;
}

/** "dd/mm/aaaa" → "AAAA-MM-DD" (data real de calendário) ou null. */
export function parseDateBR(text: string): string | null {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
    if (!m) return null;
    const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const probe = new Date(year, month - 1, day);
    if (year < 1900 || probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
}

/** "dd/mm/aaaa hh:mm" → "AAAA-MM-DDTHH:mm" ou null (hora 00–23, minuto 00–59). */
export function parseDateTimeBR(text: string): string | null {
    const m = /^(\d{2}\/\d{2}\/\d{4}) (\d{2}):(\d{2})$/.exec(text.trim());
    if (!m) return null;
    const date = parseDateBR(m[1]);
    if (!date || Number(m[2]) > 23 || Number(m[3]) > 59) return null;
    return `${date}T${m[2]}:${m[3]}`;
}

/** "AAAA-MM-DD[THH:mm…]" → "dd/mm/aaaa" (texto, sem fuso). */
export function displayDateBR(value: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** "AAAA-MM-DDTHH:mm" → "dd/mm/aaaa hh:mm". */
export function displayDateTimeBR(value: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? '');
    return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '';
}

/** Date → "AAAA-MM-DDTHH:mm" na hora local. */
export function toLocalDateTimeValue(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Date → "AAAA-MM-DD" na data local. */
export function toLocalDateValue(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type DateShortcut = { label: string; value: (now: Date) => string };

const atHour = (now: Date, addDays: number, hour: number) =>
    toLocalDateTimeValue(new Date(now.getFullYear(), now.getMonth(), now.getDate() + addDays, hour, 0, 0, 0));

export const DATETIME_SHORTCUTS: Record<'now' | 'today18' | 'tomorrow08', DateShortcut> = {
    now: { label: 'Agora', value: (now) => toLocalDateTimeValue(now) },
    today18: { label: 'Hoje 18:00', value: (now) => atHour(now, 0, 18) },
    tomorrow08: { label: 'Amanhã 08:00', value: (now) => atHour(now, 1, 8) },
};

/** Instante ISO (com fuso) → "dd/mm/aaaa hh:mm" na hora local; vazio se inválido. */
export function formatDateTimeBR(iso: string | Date | null | undefined): string {
    if (!iso) return '';
    const date = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return displayDateTimeBR(toLocalDateTimeValue(date));
}

/** Instante ISO → "dd/mm/aaaa" na data local. */
export function formatDateOnlyBR(iso: string | Date | null | undefined): string {
    if (!iso) return '';
    const date = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return displayDateBR(toLocalDateValue(date));
}
