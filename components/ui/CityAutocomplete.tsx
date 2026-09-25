import React, { useEffect, useId, useRef, useState } from 'react';
import { locationsApi, formatApiError } from '../../lib/api';

export interface CityOption {
  id: string;
  name: string;
  ibgeCode: string;
  state: { code: string; name: string };
}
interface CityAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (city: string, state: string, ibgeCode: string) => void;
  selectedIbgeCode?: string;
  placeholder?: string;
  state?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
}
export const CityAutocomplete: React.FC<CityAutocompleteProps> = ({
  value, onChange, onSelect, selectedIbgeCode, state, required = false, disabled = false,
  placeholder = 'Busque e selecione a cidade', className = '', id,
}) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [query, setQuery] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<CityOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(-1);
  const request = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const invalid = selectedIbgeCode !== undefined && !!value && !selectedIbgeCode;
  useEffect(() => { input.current?.setCustomValidity(invalid ? 'Selecione uma cidade da lista.' : ''); }, [invalid]);
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) { request.current++; setQuery(null); setOpen(false); }
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);
  useEffect(() => {
    const current = ++request.current;
    if (disabled || query === null || query.trim().length < 2) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await locationsApi.search({ q: query.trim(), state });
        if (request.current !== current) return;
        setSuggestions((response.data ?? []).filter((city: CityOption) => /^\d{7}$/.test(city.ibgeCode)));
        setError('');
      } catch (cause) {
        if (request.current !== current) return;
        setSuggestions([]); setError(formatApiError(cause));
      } finally { if (request.current === current) setLoading(false); }
    }, 300);
    return () => { clearTimeout(timer); request.current++; };
  }, [query, state, disabled]);
  const select = (city: CityOption) => {
    request.current++; setQuery(null); setOpen(false); setSuggestions([]); setActive(-1);
    onChange(`${city.name}, ${city.state.code}`);
    onSelect?.(city.name, city.state.code, city.ibgeCode);
  };
  return (
    <div ref={container} className="relative">
      <input ref={input} id={inputId} type="text" role="combobox" autoComplete="off"
        aria-label={id ? undefined : 'Cidade'} aria-autocomplete="list" aria-expanded={open && !disabled}
        aria-controls={`${inputId}-options`} aria-activedescendant={active >= 0 ? `${inputId}-option-${active}` : undefined}
        aria-invalid={invalid || undefined} aria-describedby={invalid ? `${inputId}-hint` : undefined}
        value={value} disabled={disabled} required={required} placeholder={placeholder}
        onChange={(event) => {
          request.current++; onChange(event.target.value); setQuery(event.target.value);
          setOpen(event.target.value.trim().length >= 2); setSuggestions([]); setError(''); setActive(-1);
        }}
        onFocus={() => { if (!disabled && value.length >= 2 && !selectedIbgeCode) { setQuery(value); setOpen(true); } }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'Tab') { request.current++; setQuery(null); setOpen(false); }
          if (!open) return;
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive(i => Math.min(i + 1, suggestions.length - 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
          if (event.key === 'Enter') { event.preventDefault(); if (active >= 0 && suggestions[active]) select(suggestions[active]); }
        }}
        className={className || 'w-full p-3 bg-tower-50 dark:bg-tower-700 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100'} />
      {open && !disabled && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-tower-200 bg-[var(--app-surface)] shadow-lg dark:border-tower-700">
          {loading ? <p role="status" className="p-3 text-sm">Buscando cidades…</p> : error ? <p role="alert" className="p-3 text-sm text-red-600">{error}</p> : suggestions.length === 0 ? <p role="status" className="p-3 text-sm">Nenhuma cidade encontrada. Confira o nome ou a UF.</p> : null}
          <ul id={`${inputId}-options`} role="listbox" aria-label="Cidades encontradas">
            {suggestions.map((city, index) => (
              <li key={city.id} id={`${inputId}-option-${index}`} role="option" aria-selected={index === active}>
                <button type="button" tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => select(city)}
                  className={`min-h-11 w-full px-4 py-2 text-left text-tower-900 hover:bg-brand-50 dark:text-tower-100 dark:hover:bg-tower-700 ${active === index ? 'bg-brand-50 dark:bg-tower-700' : ''}`}>
                  {city.name}, {city.state.code}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {invalid && <p id={`${inputId}-hint`} className="mt-1 text-xs text-amber-700 dark:text-amber-300">Selecione uma sugestão para confirmar a cidade.</p>}
    </div>
  );
};
