/** Formatação da Gestão V2: dinheiro, número, data e tempo relativo, sempre em pt-BR. */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

type Numeric = number | string | null | undefined;

function toNumber(value: Numeric): number | null {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

export function money(value: Numeric): string {
    const n = toNumber(value);
    return n == null ? '—' : BRL.format(n);
}

export function num(value: Numeric): string {
    const n = toNumber(value);
    return n == null ? '—' : INT.format(n);
}

export function kg(value: Numeric): string {
    const n = toNumber(value);
    return n == null ? '—' : `${INT.format(n)} kg`;
}

export function pct(value: Numeric, digits = 0): string {
    const n = toNumber(value);
    return n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`;
}

/** Plural simples: `plural(2, 'viagem', 'viagens')` → "2 viagens". */
export function plural(count: number, one: string, many: string): string {
    return `${INT.format(count)} ${count === 1 ? one : many}`;
}

export function shortId(id: string | null | undefined): string {
    return id ? id.slice(0, 8).toUpperCase() : '—';
}

function parse(iso: string | Date | null | undefined): Date | null {
    if (!iso) return null;
    const date = iso instanceof Date ? iso : new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
}

const two = (n: number) => String(n).padStart(2, '0');

export function timeHM(iso: string | Date | null | undefined): string {
    const d = parse(iso);
    return d ? `${two(d.getHours())}:${two(d.getMinutes())}` : '—';
}

export function dateShort(iso: string | Date | null | undefined): string {
    const d = parse(iso);
    return d ? `${two(d.getDate())}/${two(d.getMonth() + 1)}` : '—';
}

export function dateFull(iso: string | Date | null | undefined): string {
    const d = parse(iso);
    return d ? `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}` : '—';
}

export function dateTime(iso: string | Date | null | undefined): string {
    const d = parse(iso);
    return d ? `${dateShort(d)} ${timeHM(d)}` : '—';
}

function startOfDay(d: Date): number {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Diferença em dias de calendário (0 = mesmo dia, 1 = dia seguinte, -1 = dia anterior). */
export function dayDiff(iso: string | Date, now: Date = new Date()): number {
    const d = parse(iso);
    if (!d) return 0;
    return Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
}

/** "hoje", "ontem", "amanhã" ou "seg 10/11". */
export function dayLabel(iso: string | Date | null | undefined, now: Date = new Date()): string {
    const d = parse(iso);
    if (!d) return '—';
    const diff = dayDiff(d, now);
    if (diff === 0) return 'hoje';
    if (diff === -1) return 'ontem';
    if (diff === 1) return 'amanhã';
    return `${WEEKDAY[d.getDay()]} ${dateShort(d)}`;
}

/** "agora", "há 25 min", "há 3 h", "há 4 dias", "em 2 h". */
export function relative(iso: string | Date | null | undefined, now: Date = new Date()): string {
    const d = parse(iso);
    if (!d) return '—';
    const diff = d.getTime() - now.getTime();
    const abs = Math.abs(diff);
    const minutes = Math.floor(abs / 60_000);
    let span: string;
    if (minutes < 1) return 'agora';
    if (minutes < 60) span = `${minutes} min`;
    else if (minutes < 48 * 60) span = `${Math.floor(minutes / 60)} h`;
    else span = `${Math.floor(minutes / 1440)} dias`;
    return diff < 0 ? `há ${span}` : `em ${span}`;
}

export function greeting(now: Date = new Date()): string {
    const hour = now.getHours();
    if (hour < 5) return 'Boa madrugada';
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
}

export function longDate(now: Date = new Date()): string {
    return now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Cidade sem o sufixo de UF: "Guarulhos, SP" → "Guarulhos". */
export function cityOnly(place: string | null | undefined): string {
    if (!place) return '—';
    return place.split(/[,/|-]/)[0].trim() || place;
}
