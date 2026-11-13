import React from 'react';
import clsx from 'clsx';
import { MODE_HINT, MODE_LABEL, type Mode } from '../lib/modes';
import type { Tone } from '../lib/trips';
import { IconAlert, IconRefresh } from './icons';

/**
 * Kit da Gestão V2. Tudo que as telas usam para ter a mesma cara: vidro, modo
 * (Autopilot/Copilot/Manual), estado, botão, filtro, carregando, vazio e erro.
 * Não importa nada do app legado; as classes `gx-*` vêm de gestaos.css.
 */

/* ---------- Modo ---------- */

/** Selo do modo. Autopilot leva o ponto pulsando: é o sistema trabalhando. */
export const ModeBadge: React.FC<{ mode: Mode; className?: string }> = ({ mode, className }) => (
    <span className={clsx('gx-mode', `gx-mode-${mode}`, className)} title={MODE_HINT[mode]}>
        {mode === 'auto' ? <span className="gx-pulse" aria-hidden="true" /> : null}
        {MODE_LABEL[mode]}
    </span>
);

/* ---------- Superfícies ---------- */

export const Glass: React.FC<React.HTMLAttributes<HTMLDivElement> & { strong?: boolean; float?: boolean; tint?: 'auto' }> = ({
    strong,
    float,
    tint,
    className,
    ...rest
}) => <div className={clsx('gx-glass', strong && 'gx-glass-strong', float && 'gx-glass-float', tint === 'auto' && 'gx-tint-auto', className)} {...rest} />;

export interface PanelProps {
    title?: React.ReactNode;
    /** Linha curta sob o título: a pergunta que o painel responde. */
    hint?: React.ReactNode;
    mode?: Mode;
    /** Número de destaque ao lado do título (ex.: itens na fila). */
    count?: number | string | null;
    countTone?: Tone;
    actions?: React.ReactNode;
    tint?: 'auto';
    className?: string;
    bodyClassName?: string;
    /** `false` tira o respiro interno (listas e tabelas que encostam na borda). */
    padded?: boolean;
    children: React.ReactNode;
}

const COUNT_TONE: Record<Tone, string> = { neutral: '', royal: 'gx-royal-text', yellow: 'gx-yellow-text', red: 'gx-red-text' };

/** Painel de vidro com cabeçalho. É a unidade de composição das telas. */
export const Panel: React.FC<PanelProps> = ({ title, hint, mode, count, countTone = 'neutral', actions, tint, className, bodyClassName, padded = true, children }) => (
    <Glass tint={tint} className={clsx('flex min-w-0 flex-col', className)}>
        {title || actions ? (
            <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 pb-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h2 className="gx-h2">{title}</h2>
                        {count != null ? <span className={clsx('gx-num text-[17px]', COUNT_TONE[countTone])}>{count}</span> : null}
                        {mode ? <ModeBadge mode={mode} /> : null}
                    </div>
                    {hint ? <p className="gx-muted mt-1 text-[13px]">{hint}</p> : null}
                </div>
                {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
            </header>
        ) : null}
        <div className={clsx('min-w-0 flex-1', padded ? 'px-5 pb-5' : 'pb-2', !title && !actions && padded && 'pt-5', bodyClassName)}>{children}</div>
    </Glass>
);

/** Cabeçalho de página: título, a pergunta da tela e ações. */
export const PageHeader: React.FC<{ title: string; question?: string; mode?: Mode; actions?: React.ReactNode; eyebrow?: string }> = ({
    title,
    question,
    mode,
    actions,
    eyebrow,
}) => (
    <header className="gx-rise flex flex-wrap items-end justify-between gap-4 pb-6 pt-2">
        <div className="min-w-0">
            {eyebrow ? <p className="gx-label mb-2">{eyebrow}</p> : null}
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="gx-h1">{title}</h1>
                {mode ? <ModeBadge mode={mode} /> : null}
            </div>
            {question ? <p className="gx-question mt-2">{question}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
);

/* ---------- Estado ---------- */

export const Pill: React.FC<{ tone?: Tone | 'solid'; dot?: boolean; className?: string; children: React.ReactNode; title?: string }> = ({
    tone = 'neutral',
    dot,
    className,
    children,
    title,
}) => (
    <span className={clsx('gx-pill', tone !== 'neutral' && `gx-pill-${tone}`, className)} title={title}>
        {dot ? <span className="gx-dot" aria-hidden="true" /> : null}
        {children}
    </span>
);

/** Número grande com rótulo. `onClick` transforma em atalho. */
export const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone; onClick?: () => void; className?: string }> = ({
    label,
    value,
    hint,
    tone = 'neutral',
    onClick,
    className,
}) => {
    const body = (
        <>
            <span className="gx-label block">{label}</span>
            <span className={clsx('gx-num mt-1 block text-[30px] leading-none', COUNT_TONE[tone])}>{value}</span>
            {hint ? <span className="gx-muted mt-1.5 block text-[12.5px]">{hint}</span> : null}
        </>
    );
    return onClick ? (
        <button type="button" onClick={onClick} className={clsx('gx-row', className)}>
            {body}
        </button>
    ) : (
        <div className={clsx('px-3.5 py-3', className)}>{body}</div>
    );
};

export const Progress: React.FC<{ value: number | null | undefined; tone?: 'royal' | 'yellow' | 'red'; label?: string; className?: string }> = ({
    value,
    tone = 'royal',
    label,
    className,
}) => {
    const safe = Math.max(0, Math.min(100, Number(value) || 0));
    return (
        <div className={clsx('gx-bar', className)} data-tone={tone} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(safe)} aria-label={label}>
            <span style={{ width: `${safe}%` }} />
        </div>
    );
};

/** Par rótulo/valor em linha, para fichas. */
export const Kv: React.FC<{ label: React.ReactNode; value: React.ReactNode; mono?: boolean; strong?: boolean; className?: string }> = ({
    label,
    value,
    mono,
    strong,
    className,
}) => (
    <div className={clsx('gx-hair-b flex items-baseline justify-between gap-4 py-2.5 last:border-b-0', className)}>
        <span className={clsx(strong ? 'font-semibold' : 'gx-soft')}>{label}</span>
        <span className={clsx('text-right', mono && 'gx-mono', strong && 'gx-num text-[16px]')}>{value}</span>
    </div>
);

/* ---------- Ação ---------- */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'soft' | 'ghost' | 'danger';
    size?: 'sm' | 'md';
    /** Mostra "aguarde" e bloqueia novo clique enquanto a ação roda. */
    loading?: boolean;
    icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({ variant = 'ghost', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }) => (
    <button
        type={type}
        className={clsx('gx-btn', `gx-btn-${variant}`, size === 'sm' && 'gx-btn-sm', className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
    >
        {loading ? <IconRefresh size={15} className="animate-spin" /> : icon}
        {children}
    </button>
);

/** Filtro de visualização. `aria-pressed` carrega o estado. */
export const Chip: React.FC<{ active?: boolean; count?: number | null; onClick?: () => void; children: React.ReactNode }> = ({ active, count, onClick, children }) => (
    <button type="button" className="gx-chip" aria-pressed={Boolean(active)} onClick={onClick}>
        {children}
        {count != null ? <span className="gx-chip-count">{count}</span> : null}
    </button>
);

export const Tabs: React.FC<{ tabs: Array<{ id: string; label: string; count?: number | null }>; value: string; onChange: (id: string) => void; label: string }> = ({
    tabs,
    value,
    onChange,
    label,
}) => (
    <div className="gx-no-scrollbar flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={label}>
        {tabs.map((tab) => (
            <button key={tab.id} type="button" role="tab" aria-selected={tab.id === value} className="gx-chip" onClick={() => onChange(tab.id)}>
                {tab.label}
                {tab.count != null ? <span className="gx-chip-count">{tab.count}</span> : null}
            </button>
        ))}
    </div>
);

/* ---------- Campos ---------- */

export const Field: React.FC<{ label: string; hint?: string; error?: string | null; children: React.ReactNode; className?: string }> = ({
    label,
    hint,
    error,
    children,
    className,
}) => (
    <label className={clsx('block', className)}>
        <span className="gx-label mb-1.5 block">{label}</span>
        {children}
        {error ? <span className="gx-red-text mt-1 block text-[12.5px]">{error}</span> : hint ? <span className="gx-muted mt-1 block text-[12.5px]">{hint}</span> : null}
    </label>
);

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...rest }, ref) => (
    <input ref={ref} className={clsx('gx-input', className)} {...rest} />
));
TextInput.displayName = 'TextInput';

export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, rows = 3, ...rest }, ref) => (
    <textarea ref={ref} rows={rows} className={clsx('gx-input', className)} {...rest} />
));
TextArea.displayName = 'TextArea';

export const SelectInput = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...rest }, ref) => (
    <select ref={ref} className={clsx('gx-input', className)} {...rest}>
        {children}
    </select>
));
SelectInput.displayName = 'SelectInput';

/* ---------- Carregando, vazio, erro ---------- */

/** Esqueleto de linhas: mantém a altura do bloco enquanto o dado chega. */
export const Skeleton: React.FC<{ rows?: number; className?: string; height?: number }> = ({ rows = 4, className, height = 44 }) => (
    <div className={clsx('flex flex-col gap-2.5', className)} aria-busy="true" aria-label="Carregando">
        {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="gx-skeleton" style={{ height, opacity: 1 - index * 0.12 }} />
        ))}
    </div>
);

export const EmptyState: React.FC<{ title: string; hint?: string; action?: React.ReactNode; className?: string }> = ({ title, hint, action, className }) => (
    <div className={clsx('gx-inset flex flex-col items-center gap-1.5 px-6 py-9 text-center', className)}>
        <p className="font-semibold">{title}</p>
        {hint ? <p className="gx-muted max-w-[46ch] text-[13.5px]">{hint}</p> : null}
        {action ? <div className="mt-3">{action}</div> : null}
    </div>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void; className?: string }> = ({ message, onRetry, className }) => (
    <div className={clsx('gx-inset flex flex-wrap items-center gap-3 px-4 py-3.5', className)} role="alert">
        <IconAlert size={18} className="gx-red-text flex-none" />
        <p className="min-w-0 flex-1 text-[13.5px]">
            <span className="font-semibold">Não foi possível carregar.</span> <span className="gx-soft">{message}</span>
        </p>
        {onRetry ? (
            <Button size="sm" variant="soft" onClick={onRetry} icon={<IconRefresh size={14} />}>
                Tentar de novo
            </Button>
        ) : null}
    </div>
);

/**
 * Os três estados de uma leitura num só lugar: carregando, erro (sem dado) e conteúdo.
 * Erro com dado antigo não apaga a tela; aparece como aviso acima do conteúdo.
 */
export function Loadable<T>({
    state,
    skeleton,
    children,
    empty,
    isEmpty,
}: {
    state: { data: T | null; loading: boolean; error: string | null; reload: () => void };
    skeleton?: React.ReactNode;
    children: (data: T) => React.ReactNode;
    empty?: React.ReactNode;
    isEmpty?: (data: T) => boolean;
}): React.ReactElement {
    if (state.data == null) {
        if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
        return <>{skeleton ?? <Skeleton />}</>;
    }
    return (
        <>
            {state.error ? <ErrorState className="mb-3" message={`${state.error} Mostrando o último dado carregado.`} onRetry={state.reload} /> : null}
            {empty && isEmpty?.(state.data) ? empty : children(state.data)}
        </>
    );
}
