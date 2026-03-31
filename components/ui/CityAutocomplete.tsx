import React, { useState, useEffect, useRef } from 'react';
import { locationsApi } from '../../lib/api';

export interface CityOption {
  id: string;
  name: string;
  state: { code: string; name: string };
}

interface CityAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  /** Callback opcional ao selecionar (city, state) */
  onSelect?: (city: string, state: string) => void;
  placeholder?: string;
  state?: string;
  required?: boolean;
  className?: string;
  id?: string;
}

export const CityAutocomplete: React.FC<CityAutocompleteProps> = ({
  value,
  onChange,
  onSelect,
  placeholder = 'Ex: São Paulo, SP',
  state,
  required = false,
  className = '',
  id,
}) => {
  const [suggestions, setSuggestions] = useState<CityOption[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const searchCities = (q: string) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q || q.length < 2) {
      setSuggestions([]);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      try {
        const r = await locationsApi.search({ q, state });
        const data = (r as any)?.data ?? [];
        setSuggestions(data.slice(0, 10));
        setShowSuggestions(true);
      } catch {
        setSuggestions([]);
      }
    }, 300);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    searchCities(v);
    if (v.length < 2) setSuggestions([]);
  };

  const handleFocus = () => {
    if (value.length >= 2) searchCities(value);
  };

  const selectCity = (city: CityOption) => {
    const val = `${city.name}, ${city.state.code}`;
    onChange(val);
    onSelect?.(city.name, city.state.code);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        id={id}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        placeholder={placeholder}
        required={required}
        className={className || 'w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500'}
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-48 overflow-y-auto">
          {suggestions.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => selectCity(c)}
              className="w-full text-left px-4 py-2 hover:bg-indigo-50 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 last:border-b-0"
            >
              {c.name}, {c.state.code}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
