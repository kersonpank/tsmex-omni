import React, { useId, useState } from 'react';
import clsx from 'clsx';

/**
 * Gráficos da Gestão V2, em SVG próprio (sem dependência).
 * Regras: magnitude = uma matiz só (azul royal); estado = vermelho/amarelo e SEMPRE com rótulo;
 * sem eixo duplo; dica ao passar o mouse ou focar; toda figura tem "Ver como tabela".
 */

export type ChartTone = 'royal' | 'red' | 'yellow';
const FILL: Record<ChartTone, string> = { royal: 'var(--gx-royal)', red: 'var(--gx-red)', yellow: 'var(--gx-yellow)' };

export interface ChartTable { head: string[]; rows: string[][] }

/** Moldura de um gráfico: título, pergunta e alternância gráfico/tabela. */
export const ChartCard: React.FC<{ title: string; hint?: string; table: ChartTable; className?: string; children: React.ReactNode }> = ({ title, hint, table, className, children }) => {
    const [asTable, setAsTable] = useState(false);
    const id = useId();
    return (
        <figure className={clsx('gx-inset min-w-0 p-4', className)} aria-labelledby={id}>
            <figcaption className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                    <p id={id} className="text-[14.5px] font-semibold">{title}</p>
                    {hint ? <p className="gx-muted text-[12.5px]">{hint}</p> : null}
                </div>
                <button type="button" className="gx-btn gx-btn-ghost gx-btn-sm" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
                    {asTable ? 'Ver gráfico' : 'Ver como tabela'}
                </button>
            </figcaption>
            {asTable ? (
                <div className="gx-scroll-x">
                    <table className="w-full text-left text-[13px]">
                        <caption className="sr-only">{title}</caption>
                        <thead>
                            <tr>
                                {table.head.map((cell, i) => (
                                    <th key={cell + i} scope="col" className={clsx('gx-label gx-hair-b py-2 pr-3', i > 0 && 'text-right')}>{cell}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {table.rows.map((row, r) => (
                                <tr key={r}>
                                    {row.map((cell, i) => (
                                        <td key={i} className={clsx('gx-hair-b py-2 pr-3', i > 0 && 'gx-mono text-right')}>{cell}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                children
            )}
        </figure>
    );
};

/* ---------- Barra horizontal ranqueada ---------- */

export interface RankedItem {
    key: string;
    label: string;
    value: number;
    /** Valor já formatado (ex.: "R$ 1.200,00"). */
    display: string;
    /** Detalhe mostrado na dica e sob o rótulo. */
    detail?: string;
    tone?: ChartTone;
    /** Texto de estado ao lado do valor (ex.: "abaixo de zero"); obrigatório quando o tom não é royal. */
    badge?: string;
}

const Tip: React.FC<{ title: string; value: string; detail?: string }> = ({ title, value, detail }) => (
    <span role="tooltip" className="gx-glass gx-glass-float pointer-events-none absolute right-0 top-full z-20 mt-1 min-w-[180px] px-3 py-2 text-[12.5px]" style={{ borderRadius: 12 }}>
        <span className="gx-num block text-[15px]">{value}</span>
        <span className="gx-soft block">{title}</span>
        {detail ? <span className="gx-muted block">{detail}</span> : null}
    </span>
);

/** Ranking em barras horizontais. Valor negativo mostra barra vazia em vermelho com o selo. */
export const RankedBars: React.FC<{ items: RankedItem[]; ariaLabel: string; className?: string }> = ({ items, ariaLabel, className }) => {
    const [active, setActive] = useState<string | null>(null);
    const max = Math.max(1, ...items.map((item) => Math.abs(item.value)));
    return (
        <ul className={clsx('flex flex-col gap-2', className)} aria-label={ariaLabel}>
            {items.map((item) => {
                const tone = item.tone ?? (item.value < 0 ? 'red' : 'royal');
                const width = Math.max(item.value > 0 ? 2 : 0, (Math.abs(item.value) / max) * 100);
                const on = active === item.key;
                return (
                    <li
                        key={item.key}
                        tabIndex={0}
                        className="relative grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-1 py-1 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto]"
                        style={on ? { background: 'var(--gx-hover)' } : undefined}
                        onMouseEnter={() => setActive(item.key)}
                        onMouseLeave={() => setActive((cur) => (cur === item.key ? null : cur))}
                        onFocus={() => setActive(item.key)}
                        onBlur={() => setActive((cur) => (cur === item.key ? null : cur))}
                    >
                        <span className="min-w-0">
                            <span className="block truncate text-[13.5px]" title={item.label}>{item.label}</span>
                            {item.detail ? <span className="gx-muted block truncate text-[12px]">{item.detail}</span> : null}
                        </span>
                        <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-3 w-full" aria-hidden="true" focusable="false">
                            <rect x="0" y="0" width="100" height="10" rx="3" style={{ fill: 'var(--gx-hair)' }} />
                            <rect x="0" y="0" width={width} height="10" rx="3" style={{ fill: FILL[tone], opacity: on ? 1 : 0.88 }} />
                        </svg>
                        <span className="text-right">
                            <span className="gx-num text-[13.5px]">{item.display}</span>
                            {item.badge ? <span className={clsx('ml-2 text-[12px] font-semibold', tone === 'red' ? 'gx-red-text' : tone === 'yellow' ? 'gx-yellow-text' : 'gx-royal-text')}>{item.badge}</span> : null}
                        </span>
                        {on ? <Tip title={item.label} value={item.display} detail={item.detail} /> : null}
                    </li>
                );
            })}
        </ul>
    );
};

/* ---------- Barras por mês ---------- */

export interface MonthItem { key: string; label: string; value: number; display: string }

/** Uma série por gráfico (sem eixo duplo): colunas por mês, valor escrito acima de cada uma. */
export const MonthBars: React.FC<{ items: MonthItem[]; ariaLabel: string; className?: string }> = ({ items, ariaLabel, className }) => {
    const [active, setActive] = useState<string | null>(null);
    const slot = 64;
    const height = 130;
    const base = 100;
    const max = Math.max(1, ...items.map((item) => item.value));
    const current = items.find((item) => item.key === active);
    return (
        <div className={clsx('relative', className)}>
            <div className="gx-scroll-x">
                <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${Math.max(items.length, 1) * slot} ${height}`} style={{ width: '100%', minWidth: Math.min(items.length * 44, 560), height: 'auto', maxHeight: 190 }}>
                    <line x1="0" x2={items.length * slot} y1={base} y2={base} style={{ stroke: 'var(--gx-hair-strong)' }} strokeWidth="1" />
                    {items.map((item, index) => {
                        const barH = item.value > 0 ? Math.max(2, (item.value / max) * 70) : 0;
                        const x = index * slot + 12;
                        const on = active === item.key;
                        return (
                            <g
                                key={item.key}
                                tabIndex={0}
                                onMouseEnter={() => setActive(item.key)}
                                onMouseLeave={() => setActive((cur) => (cur === item.key ? null : cur))}
                                onFocus={() => setActive(item.key)}
                                onBlur={() => setActive((cur) => (cur === item.key ? null : cur))}
                            >
                                <rect x={index * slot} y="0" width={slot} height={height} style={{ fill: 'transparent' }} />
                                <rect x={x} y={base - barH} width={slot - 24} height={barH} rx="3" style={{ fill: FILL.royal, opacity: on ? 1 : 0.88 }} />
                                <text x={x + (slot - 24) / 2} y={base - barH - 5} textAnchor="middle" fontSize="9" style={{ fill: 'var(--gx-ink)' }}>{item.display}</text>
                                <text x={x + (slot - 24) / 2} y={base + 16} textAnchor="middle" fontSize="10" style={{ fill: 'var(--gx-ink)', opacity: 0.7 }}>{item.label}</text>
                            </g>
                        );
                    })}
                </svg>
            </div>
            {current ? (
                <span role="tooltip" className="gx-glass gx-glass-float pointer-events-none absolute right-0 top-0 z-20 px-3 py-2 text-[12.5px]" style={{ borderRadius: 12 }}>
                    <span className="gx-num block text-[15px]">{current.display}</span>
                    <span className="gx-soft block">{current.label}</span>
                </span>
            ) : null}
        </div>
    );
};

/* ---------- Número de destaque com comparação ---------- */

export const Highlight: React.FC<{
    label: string;
    value: string;
    /** Comparação ou contexto em texto ("de R$ 10 estimados", "meta 90%"). */
    compare?: string;
    /** Estado em palavras; o tom colore, mas o texto sempre aparece. */
    status?: { text: string; tone: Exclude<ChartTone, 'royal'> };
    className?: string;
}> = ({ label, value, compare, status, className }) => (
    <div className={clsx('px-3.5 py-3', className)}>
        <span className="gx-label block">{label}</span>
        <span className={clsx('gx-num mt-1 block text-[30px] leading-none', status?.tone === 'red' && 'gx-red-text')}>{value}</span>
        {compare ? <span className="gx-muted mt-1.5 block text-[12.5px]">{compare}</span> : null}
        {status ? <span className={clsx('mt-1 block text-[12.5px] font-semibold', status.tone === 'red' ? 'gx-red-text' : 'gx-yellow-text')}>{status.text}</span> : null}
    </div>
);

/* ---------- Barra de progresso com meta ---------- */

/** Percentual real contra a linha da meta. Abaixo da meta = vermelho + texto. */
export const GoalProgress: React.FC<{ value: number | null; target: number; label: string; className?: string }> = ({ value, target, label, className }) => {
    const hasValue = value != null && Number.isFinite(value);
    const safe = hasValue ? Math.max(0, Math.min(100, value)) : 0;
    const meets = hasValue && value >= target;
    const tone: ChartTone = !hasValue ? 'royal' : meets ? 'royal' : 'red';
    const status = !hasValue ? 'Sem amostra no período' : meets ? 'Na meta' : 'Abaixo da meta';
    return (
        <div className={className}>
            <svg viewBox="0 0 100 14" preserveAspectRatio="none" className="h-4 w-full" role="img" aria-label={`${label}: ${hasValue ? `${value}%` : 'sem amostra'}, meta ${target}%`}>
                <rect x="0" y="3" width="100" height="8" rx="3" style={{ fill: 'var(--gx-hair-strong)' }} />
                <rect x="0" y="3" width={safe} height="8" rx="3" style={{ fill: FILL[tone] }} />
                <line x1={target} x2={target} y1="0" y2="14" strokeWidth="1.4" vectorEffect="non-scaling-stroke" style={{ stroke: 'var(--gx-ink)' }} />
            </svg>
            <div className="relative mt-1 h-4 text-[12px]">
                <span className="gx-muted absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${Math.min(Math.max(target, 8), 92)}%` }}>Meta {target}%</span>
            </div>
            <p className={clsx('text-[13px] font-semibold', hasValue && !meets && 'gx-red-text')}>{status}</p>
        </div>
    );
};
