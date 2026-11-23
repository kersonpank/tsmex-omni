/** Helpers puros da área Desempenho: período, rótulos e formatação das métricas. */

export type PresetId = '7' | '30' | '90' | 'mes' | 'mes-anterior' | 'custom';
export interface Period { from: string; to: string }

export const PRESETS: Array<{ id: Exclude<PresetId, 'custom'>; label: string }> = [
    { id: '7', label: '7 dias' },
    { id: '30', label: '30 dias' },
    { id: '90', label: '90 dias' },
    { id: 'mes', label: 'Mês atual' },
    { id: 'mes-anterior', label: 'Mês anterior' },
];

export const TABS = [
    { id: 'operacao', label: 'Operação' },
    { id: 'entrega', label: 'Entrega' },
    { id: 'caixa', label: 'Caixa' },
    { id: 'excecoes', label: 'Exceções' },
    { id: 'aprendizado', label: 'Aprendizado' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

export const MAX_PERIOD_DAYS = 366;
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** AAAA-MM-DD no calendário local. */
export function isoDay(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function periodForPreset(id: Exclude<PresetId, 'custom'>, now: Date = new Date()): Period {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (id === 'mes') return { from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDay(today) };
    if (id === 'mes-anterior') {
        return { from: isoDay(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: isoDay(new Date(today.getFullYear(), today.getMonth(), 0)) };
    }
    const days = Number(id);
    return { from: isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1))), to: isoDay(today) };
}

export const DEFAULT_PRESET: Exclude<PresetId, 'custom'> = '30';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (value: string | null | undefined): value is string => !!value && DAY_RE.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());

/** Lê `?de=&ate=`; sem os dois (ou inválidos) cai no padrão de 30 dias. */
export function periodFromParams(de: string | null, ate: string | null, now: Date = new Date()): Period {
    if (validDay(de) && validDay(ate)) return { from: de, to: ate };
    return periodForPreset(DEFAULT_PRESET, now);
}

export function presetOf(period: Period, now: Date = new Date()): PresetId {
    for (const preset of PRESETS) {
        const candidate = periodForPreset(preset.id, now);
        if (candidate.from === period.from && candidate.to === period.to) return preset.id;
    }
    return 'custom';
}

/** Mensagem de erro do período, ou null se estiver válido. */
export function periodError(period: Period): string | null {
    if (!validDay(period.from) || !validDay(period.to)) return 'Informe as duas datas.';
    const from = new Date(`${period.from}T00:00:00`).getTime();
    const to = new Date(`${period.to}T00:00:00`).getTime();
    if (from > to) return 'A data inicial não pode ser depois da final.';
    if (Math.round((to - from) / DAY_MS) + 1 > MAX_PERIOD_DAYS) return `O período vai até ${MAX_PERIOD_DAYS} dias.`;
    return null;
}

export function parseTab(value: string | null): TabId {
    return TABS.some((tab) => tab.id === value) ? (value as TabId) : 'operacao';
}

export function periodLabel(period: Period): string {
    const fmt = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
    return `${fmt(period.from)} a ${fmt(period.to)}`;
}

/* ---------- formatação ---------- */

/** Centavos para reais, pronto para `money()`. */
export const cents = (value: number | null | undefined): number | null => (value == null ? null : value / 100);

export function percentText(value: number | null | undefined, digits = 1): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: digits })}%`;
}

/** Horas em texto humano: "5 h", "2 d 4 h". */
export function hoursText(hours: number | null | undefined): string {
    if (hours == null || !Number.isFinite(hours)) return '—';
    if (hours < 1) return `${Math.round(hours * 60)} min`;
    if (hours < 24) return `${hours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
    const days = Math.floor(hours / 24);
    const rest = Math.round(hours - days * 24);
    return rest > 0 ? `${days} d ${rest} h` : `${days} d`;
}

export function daysText(days: number | null | undefined): string {
    if (days == null || !Number.isFinite(days)) return '—';
    return `${days.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${days === 1 ? 'dia' : 'dias'}`;
}

export function monthLabel(month: string): string {
    const names = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const [year, mm] = month.split('-');
    const name = names[Number(mm) - 1];
    return name ? `${name}/${(year ?? '').slice(2)}` : month;
}

function humanize(code: string): string {
    const text = code.replace(/[_-]+/g, ' ').trim().toLowerCase();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '—';
}

const CATEGORY_LABEL: Record<string, string> = {
    FISCAL_PROVIDER_QUOTA: 'Cota do provedor fiscal',
    FISCAL_PROVIDER_ERROR: 'Erro do provedor fiscal',
    FISCAL_DISTRIBUICAO_NFE_QUOTA: 'Cota da distribuição de NF-e',
    FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED: 'Distribuição de NF-e sem início',
    FISCAL_ENCERRAMENTO_PENDENTE: 'Encerramento fiscal pendente',
    OPERATIONAL_ARRIVAL_DIVERGENCE: 'Divergência na chegada',
    OPERATIONAL_STOCK_AGING: 'Carga parada no hub',
    OPERATIONAL_TRIP_LATE: 'Viagem atrasada',
    OPERATIONAL_UNROUTED: 'Carga sem rota',
    GENERIC: 'Outros alertas',
};
export const categoryLabel = (category: string): string => CATEGORY_LABEL[category] ?? humanize(category);

const ROUTINE_LABEL: Record<string, string> = {
    DESCONHECIDA: 'Origem não identificada',
    next_hop_queue: 'Fila do próximo trecho',
};
export const routineLabel = (routine: string): string => ROUTINE_LABEL[routine] ?? humanize(routine);

export function targetState(percent: number | null | undefined, target: number): 'below' | 'meets' | 'none' {
    if (percent == null) return 'none';
    return percent >= target ? 'meets' : 'below';
}
