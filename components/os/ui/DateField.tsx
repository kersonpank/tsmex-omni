import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
    DATETIME_SHORTCUTS,
    displayDateBR,
    displayDateTimeBR,
    maskDateBR,
    parseDateBR,
    parseDateTimeBR,
    type DateShortcut,
} from '../lib/dateBR';
import { osFieldClass } from './Sheet';

/**
 * Campo de data/hora do O.S.: digitação com máscara dd/mm/aaaa (hh:mm em 24 h), teclado numérico
 * no celular e validação clara — independe do idioma do navegador. O valor segue o formato dos
 * inputs nativos ("AAAA-MM-DD" / "AAAA-MM-DDTHH:mm"); fica vazio enquanto o texto não for uma data válida.
 */

type Props = {
    value: string;
    onChange: (value: string) => void;
    /** Atalhos de um toque (só no campo com hora). */
    shortcuts?: Array<keyof typeof DATETIME_SHORTCUTS>;
    /** Data mínima "AAAA-MM-DD" (inclusive). */
    min?: string;
    className?: string;
    disabled?: boolean;
    'aria-label'?: string;
};

const Base: React.FC<Props & { withTime: boolean }> = ({ value, onChange, shortcuts = [], min, className, disabled, withTime, ...rest }) => {
    const toDisplay = withTime ? displayDateTimeBR : displayDateBR;
    const parse = withTime ? parseDateTimeBR : parseDateBR;
    const [text, setText] = useState(() => toDisplay(value));
    const [touched, setTouched] = useState(false);

    useEffect(() => {
        // Valor vindo de fora (atalho, carga inicial) substitui o texto; digitação em curso não.
        if (value !== (parse(text) ?? '')) setText(toDisplay(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const parsed = parse(text);
    const belowMin = Boolean(parsed && min && parsed.slice(0, 10) < min);
    const incomplete = text.length > 0 && !parsed;
    const error = !touched
        ? null
        : incomplete
          ? `Use o formato ${withTime ? 'dd/mm/aaaa hh:mm (24 h)' : 'dd/mm/aaaa'} com uma data válida.`
          : belowMin
            ? `A data não pode ser antes de ${displayDateBR(min)}.`
            : null;

    const handle = (raw: string) => {
        const masked = maskDateBR(raw, withTime);
        setText(masked);
        const next = parse(masked);
        onChange(next && !(min && next.slice(0, 10) < min) ? next : '');
    };

    const apply = (shortcut: DateShortcut) => {
        const next = shortcut.value(new Date());
        setText(toDisplay(next));
        setTouched(false);
        onChange(next);
    };

    return (
        <div>
            <input
                {...rest}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                disabled={disabled}
                value={text}
                placeholder={withTime ? 'dd/mm/aaaa hh:mm' : 'dd/mm/aaaa'}
                maxLength={withTime ? 16 : 10}
                onChange={(e) => handle(e.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={Boolean(error)}
                className={clsx(osFieldClass, error && 'border-brand-red-500', className)}
            />
            {error ? <p role="alert" className="mt-1 text-[12px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p> : null}
            {withTime && shortcuts.length > 0 && !disabled ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {shortcuts.map((key) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => apply(DATETIME_SHORTCUTS[key])}
                            className="min-h-9 rounded-full border border-tower-300 px-3 text-[12px] font-bold text-tower-700 active:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:active:bg-tower-800"
                        >
                            {DATETIME_SHORTCUTS[key].label}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
};

export const DateTimeField: React.FC<Props> = (props) => <Base {...props} withTime />;
export const DateField: React.FC<Props> = (props) => <Base {...props} withTime={false} />;
