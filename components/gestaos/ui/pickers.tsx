import React, { useEffect, useId, useRef, useState } from 'react';
import {
    clientsApi,
    cnpjApi,
    fiscalEmittersApi,
    formatApiError,
    hubsApi,
    linksApi,
    locationsApi,
    personsApi,
    vehicleTypesApi,
} from '../../../lib/api';
import type { Client, FiscalEmitter, Hub, Link, Person, VehicleType } from '../../../types/index';
import { useResource, type UseResourceResult } from '../lib/resource';
import { formatCep, formatCnpjCpf, isValidCnpj, isValidCpf, onlyDigits } from './form';
import { Button, ErrorState, SelectInput, TextInput } from './kit';

/**
 * Seletores da Gestão V2: busca com sugestões (pessoa, cidade), CEP e selects alimentados por
 * `useResource`. A lógica vem dos componentes clássicos (PersonAutocomplete, CityAutocomplete,
 * DocumentInput, PersonFormModal); o visual é `gx-*`. Resposta atrasada nunca sobrescreve a nova.
 */

/* ======================================================================
 * Base: caixa de busca com lista (setas, Enter, Esc)
 * ==================================================================== */

interface ComboAction {
    id: string;
    label: string;
    onSelect: () => void;
}

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

interface SearchComboboxProps<T> {
    search: (query: string) => Promise<T[]>;
    itemKey: (item: T) => string;
    itemLabel: (item: T) => string;
    renderItem: (item: T) => React.ReactNode;
    onSelect: (item: T) => void;
    /** Ações extras no fim da lista (ex.: "Cadastrar pelo CNPJ"); navegáveis pelo teclado. */
    actions?: (ctx: { query: string; results: T[]; status: SearchStatus }) => ComboAction[];
    emptyText?: (query: string) => React.ReactNode;
    placeholder?: string;
    ariaLabel: string;
    minChars?: number;
    delay?: number;
    id?: string;
    disabled?: boolean;
    invalid?: boolean;
    autoFocus?: boolean;
}

function SearchCombobox<T>({
    search,
    itemKey,
    itemLabel,
    renderItem,
    onSelect,
    actions,
    emptyText,
    placeholder,
    ariaLabel,
    minChars = 2,
    delay = 350,
    id,
    disabled,
    invalid,
    autoFocus,
}: SearchComboboxProps<T>) {
    const generated = useId();
    const baseId = id ?? generated;
    const [text, setText] = useState('');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<T[]>([]);
    const [status, setStatus] = useState<SearchStatus>('idle');
    const [error, setError] = useState('');
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [retry, setRetry] = useState(0);
    const token = useRef(0);
    const box = useRef<HTMLDivElement>(null);
    const searchRef = useRef(search);
    searchRef.current = search;

    useEffect(() => {
        const timer = window.setTimeout(() => setQuery(text), delay);
        return () => window.clearTimeout(timer);
    }, [text, delay]);

    useEffect(() => {
        const mine = ++token.current;
        const q = query.trim();
        if (q.length < minChars) {
            setStatus('idle');
            setResults([]);
            return;
        }
        setStatus('loading');
        searchRef.current(q).then(
            (items) => {
                if (token.current !== mine) return;
                setResults(items);
                setError('');
                setStatus('ready');
            },
            (cause) => {
                if (token.current !== mine) return;
                setResults([]);
                setError(formatApiError(cause));
                setStatus('error');
            },
        );
        return () => {
            token.current++;
        };
    }, [query, minChars, retry]);

    useEffect(() => {
        const outside = (event: MouseEvent) => {
            if (!box.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', outside);
        return () => document.removeEventListener('mousedown', outside);
    }, []);

    // Só mostra ações quando a lista já reflete o que está escrito (nada de ação sobre busca velha).
    const settled = status === 'ready' && query === text;
    const extra = settled ? actions?.({ query: query.trim(), results, status }) ?? [] : [];
    const total = results.length + extra.length;
    const optionId = (index: number) => `${baseId}-opt-${index}`;
    const short = text.trim().length < minChars;
    const showMenu = open && !disabled;

    const choose = (index: number) => {
        if (index < results.length) {
            const item = results[index];
            setOpen(false);
            setActive(-1);
            onSelect(item);
        } else {
            const action = extra[index - results.length];
            setOpen(false);
            setActive(-1);
            action?.onSelect();
        }
    };

    return (
        <div ref={box} className="relative">
            <TextInput
                id={baseId}
                role="combobox"
                autoComplete="off"
                autoFocus={autoFocus}
                aria-label={ariaLabel}
                aria-autocomplete="list"
                aria-expanded={showMenu}
                aria-controls={`${baseId}-list`}
                aria-activedescendant={showMenu && active >= 0 ? optionId(active) : undefined}
                aria-invalid={invalid || undefined}
                disabled={disabled}
                placeholder={placeholder}
                value={text}
                onChange={(event) => {
                    setText(event.target.value);
                    setOpen(true);
                    setActive(-1);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        if (open) event.stopPropagation();
                        setOpen(false);
                    } else if (event.key === 'Tab') setOpen(false);
                    else if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        setOpen(true);
                        setActive((i) => (total === 0 ? -1 : Math.min(i + 1, total - 1)));
                    } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        setActive((i) => (total === 0 ? -1 : Math.max(i - 1, 0)));
                    } else if (event.key === 'Enter' && open) {
                        event.preventDefault();
                        if (active >= 0 && active < total) choose(active);
                    }
                }}
            />
            {showMenu ? (
                <div className="gx-menu">
                    {short ? (
                        <p role="status" className="gx-muted px-3 py-2.5 text-[13px]">
                            Digite ao menos {minChars} caracteres.
                        </p>
                    ) : status === 'error' ? (
                        <div role="alert" className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-[13px]">
                            <span className="gx-red-text min-w-0 flex-1">{error}</span>
                            <Button size="sm" variant="soft" onClick={() => setRetry((n) => n + 1)}>
                                Tentar de novo
                            </Button>
                        </div>
                    ) : !settled ? (
                        <p role="status" className="gx-muted px-3 py-2.5 text-[13px]">
                            Buscando…
                        </p>
                    ) : results.length === 0 ? (
                        <p role="status" className="gx-muted px-3 py-2.5 text-[13px]">
                            {emptyText ? emptyText(query.trim()) : 'Nada encontrado.'}
                        </p>
                    ) : null}
                    {settled && total > 0 ? (
                        <ul id={`${baseId}-list`} role="listbox" aria-label={ariaLabel} className="m-0 list-none p-0">
                            {results.map((item, index) => (
                                <li key={itemKey(item)} id={optionId(index)} role="option" aria-selected={index === active} aria-label={itemLabel(item)}>
                                    <button type="button" tabIndex={-1} className="gx-option" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>
                                        {renderItem(item)}
                                    </button>
                                </li>
                            ))}
                            {extra.map((action, offset) => {
                                const index = results.length + offset;
                                return (
                                    <li key={action.id} id={optionId(index)} role="option" aria-selected={index === active}>
                                        <button type="button" tabIndex={-1} className="gx-option gx-royal-text font-semibold" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>
                                            {action.label}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <ul id={`${baseId}-list`} role="listbox" aria-label={ariaLabel} hidden />
                    )}
                </div>
            ) : null}
        </div>
    );
}

/** Valor escolhido num seletor: dois textos e "Trocar". */
function SelectedBox({ title, detail, onClear, disabled, invalid }: { title: string; detail?: string; onClear: () => void; disabled?: boolean; invalid?: boolean }) {
    return (
        <div className="gx-input flex items-center gap-3" aria-invalid={invalid || undefined} style={{ minHeight: 48 }}>
            <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{title}</p>
                {detail ? <p className="gx-muted gx-mono truncate text-[12.5px]">{detail}</p> : null}
            </div>
            {!disabled ? (
                <Button size="sm" variant="ghost" aria-label={`Trocar ${title}`} onClick={onClear}>
                    Trocar
                </Button>
            ) : null}
        </div>
    );
}

/* ======================================================================
 * PersonPicker
 * ==================================================================== */

/** Resumo da pessoa escolhida (id + o que a tela precisa mostrar). */
export interface PersonSummary {
    id: string;
    legalName: string;
    tradeName?: string | null;
    document: string;
    documentType: 'CPF' | 'CNPJ';
    city?: string | null;
    state?: string | null;
    cityIbgeCode?: string | null;
}

export const toPersonSummary = (p: Person): PersonSummary => ({
    id: p.id,
    legalName: p.legalName,
    tradeName: p.tradeName ?? null,
    document: p.document,
    documentType: p.documentType,
    city: p.city ?? null,
    state: p.state ?? null,
    cityIbgeCode: p.cityIbgeCode ?? null,
});

const placeText = (p: { city?: string | null; state?: string | null }) => [p.city, p.state].filter(Boolean).join('/');
const personDetail = (p: PersonSummary) => [formatCnpjCpf(p.document), placeText(p)].filter(Boolean).join(' · ');

/** Corpo mínimo que o servidor aceita, a partir da consulta de CNPJ. Endereço só entra com município confirmado (IBGE). */
export function buildPersonFromCnpj(document: string, data: Record<string, any> | null | undefined) {
    const address = data?.address ?? {};
    const hasCity = Boolean(address.cityIbgeCode && address.city && address.state);
    return {
        documentType: 'CNPJ' as const,
        document,
        legalName: String(data?.legalName ?? '').trim(),
        tradeName: data?.tradeName || undefined,
        ...(hasCity
            ? {
                  cep: address.zipCode || undefined,
                  address: address.street || undefined,
                  number: address.number || undefined,
                  complement: address.complement || undefined,
                  neighborhood: address.neighborhood || undefined,
                  city: address.city,
                  state: address.state,
                  cityIbgeCode: address.cityIbgeCode,
              }
            : {}),
        country: 'BRASIL',
        stateRegistration: data?.stateRegistration || undefined,
    };
}

type CreateDraft = { document: string; documentType: 'CPF' | 'CNPJ' };

/** Cadastro rápido dentro do campo: CNPJ consulta e grava; CPF pede só o nome. */
function QuickCreatePerson({ draft, onCreated, onCancel }: { draft: CreateDraft; onCreated: (person: Person) => void; onCancel: () => void }) {
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(draft.documentType === 'CNPJ');
    const [error, setError] = useState('');
    const [note, setNote] = useState('');
    const started = useRef(false);
    const mounted = useRef(true);
    useEffect(() => () => void (mounted.current = false), []);

    const save = async (payload: ReturnType<typeof buildPersonFromCnpj> | { documentType: 'CPF'; document: string; legalName: string; country: string }) => {
        setBusy(true);
        setError('');
        try {
            const response = await personsApi.create(payload);
            const person = ((response as { data?: Person })?.data ?? response) as Person;
            if (mounted.current) onCreated(person);
        } catch (cause) {
            if (mounted.current) setError(formatApiError(cause));
        } finally {
            if (mounted.current) setBusy(false);
        }
    };

    const importCnpj = async () => {
        setBusy(true);
        setError('');
        try {
            const response = await cnpjApi.consult(draft.document);
            const payload = buildPersonFromCnpj(draft.document, ((response as { data?: Record<string, unknown> })?.data ?? response) as Record<string, unknown>);
            if (!payload.legalName) throw new Error('A consulta não trouxe a razão social. Cadastre a pessoa na Rede.');
            if (!('city' in payload)) setNote('Endereço sem município confirmado: a pessoa foi cadastrada só com o CNPJ e o nome.');
            await save(payload);
        } catch (cause) {
            if (!mounted.current) return;
            const status = (cause as { response?: { status?: number } })?.response?.status;
            setError(status === 404 ? 'CNPJ não encontrado na Receita.' : status === 429 ? 'Muitas consultas seguidas, tente de novo em instantes.' : cause instanceof Error && !('response' in cause) ? cause.message : formatApiError(cause));
            setBusy(false);
        }
    };

    useEffect(() => {
        if (draft.documentType === 'CNPJ' && !started.current) {
            started.current = true;
            void importCnpj();
        }
        // consulta uma vez ao abrir
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="gx-inset flex flex-col gap-3 p-3.5" role="group" aria-label={`Cadastrar ${draft.documentType} ${formatCnpjCpf(draft.document)}`}>
            <p className="text-[13.5px] font-semibold">
                Cadastrar {draft.documentType} <span className="gx-mono">{formatCnpjCpf(draft.document)}</span>
            </p>
            {draft.documentType === 'CPF' ? (
                <TextInput aria-label="Nome completo" placeholder="Nome completo" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
            ) : busy ? (
                <p role="status" className="gx-muted text-[13px]">
                    Consultando CNPJ na Receita e cadastrando…
                </p>
            ) : null}
            {note ? <p className="gx-muted text-[12.5px]">{note}</p> : null}
            {error ? (
                <p role="alert" className="gx-red-text text-[13px] font-semibold">
                    {error}
                </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
                {draft.documentType === 'CPF' ? (
                    <Button
                        size="sm"
                        variant="primary"
                        loading={busy}
                        disabled={name.trim().length < 3}
                        onClick={() => void save({ documentType: 'CPF', document: draft.document, legalName: name.trim(), country: 'BRASIL' })}
                    >
                        Cadastrar pessoa
                    </Button>
                ) : error ? (
                    <Button size="sm" variant="soft" onClick={() => void importCnpj()}>
                        Tentar de novo
                    </Button>
                ) : null}
                <Button size="sm" variant="ghost" disabled={busy && draft.documentType === 'CPF'} onClick={onCancel}>
                    Voltar
                </Button>
            </div>
        </div>
    );
}

export interface PersonPickerProps {
    value: PersonSummary | null;
    /** `person` vem junto só quando a pessoa acabou de ser escolhida/cadastrada (dados completos: IE, endereço). */
    onChange: (value: PersonSummary | null, person?: Person) => void;
    /** Restringe a busca a CPF ou CNPJ. */
    documentType?: 'CPF' | 'CNPJ';
    placeholder?: string;
    ariaLabel?: string;
    /** Oferece "Cadastrar pelo CNPJ/CPF" quando a busca por documento não acha ninguém. Padrão: sim. */
    allowCreate?: boolean;
    disabled?: boolean;
    invalid?: boolean;
    id?: string;
}

/** Busca pessoa por nome ou documento; sem resultado e com CNPJ/CPF válido, cadastra ali mesmo. */
export function PersonPicker({ value, onChange, documentType, placeholder = 'Nome ou CNPJ/CPF', ariaLabel = 'Pessoa', allowCreate = true, disabled, invalid, id }: PersonPickerProps) {
    const [draft, setDraft] = useState<CreateDraft | null>(null);
    const [cleared, setCleared] = useState(false);

    if (value) {
        return (
            <SelectedBox
                title={value.tradeName ? `${value.legalName} (${value.tradeName})` : value.legalName}
                detail={personDetail(value)}
                disabled={disabled}
                invalid={invalid}
                onClear={() => {
                    setCleared(true);
                    onChange(null);
                }}
            />
        );
    }
    if (draft) {
        return (
            <QuickCreatePerson
                draft={draft}
                onCancel={() => setDraft(null)}
                onCreated={(person) => {
                    setDraft(null);
                    onChange(toPersonSummary(person), person);
                }}
            />
        );
    }

    return (
        <SearchCombobox<Person>
            id={id}
            ariaLabel={ariaLabel}
            placeholder={placeholder}
            disabled={disabled}
            invalid={invalid}
            autoFocus={cleared}
            search={async (q) => {
                const response = await personsApi.search(q, documentType);
                const data = (response as { data?: Person[] })?.data ?? [];
                return Array.isArray(data) ? data : [];
            }}
            itemKey={(p) => p.id}
            itemLabel={(p) => `${p.legalName} ${formatCnpjCpf(p.document)}`}
            onSelect={(person) => onChange(toPersonSummary(person), person)}
            renderItem={(p) => (
                <>
                    <span className="block text-[14px] font-semibold">{p.tradeName && p.tradeName !== p.legalName ? `${p.legalName} (${p.tradeName})` : p.legalName}</span>
                    <span className="gx-muted gx-mono block text-[12.5px]">
                        {[formatCnpjCpf(p.document), placeText(p)].filter(Boolean).join(' · ')}
                        {p.clients && p.clients.length > 0 ? ' · Cliente' : ''}
                    </span>
                </>
            )}
            emptyText={(q) => {
                const digits = onlyDigits(q);
                if (digits.length === 14 && !isValidCnpj(digits)) return 'Nenhuma pessoa encontrada. O CNPJ digitado é inválido; confira os números.';
                if (digits.length === 11 && !isValidCpf(digits)) return 'Nenhuma pessoa encontrada. O CPF digitado é inválido; confira os números.';
                return allowCreate ? 'Nenhuma pessoa encontrada. Para cadastrar, digite o CNPJ (14 dígitos) ou o CPF (11).' : 'Nenhuma pessoa encontrada.';
            }}
            actions={({ query, results }) => {
                if (!allowCreate || results.length > 0) return [];
                const digits = onlyDigits(query);
                if (digits.length === 14 && isValidCnpj(digits) && documentType !== 'CPF') {
                    return [{ id: 'create-cnpj', label: `Cadastrar pelo CNPJ ${formatCnpjCpf(digits)}`, onSelect: () => setDraft({ document: digits, documentType: 'CNPJ' }) }];
                }
                if (digits.length === 11 && isValidCpf(digits) && documentType !== 'CNPJ') {
                    return [{ id: 'create-cpf', label: `Cadastrar pelo CPF ${formatCnpjCpf(digits)}`, onSelect: () => setDraft({ document: digits, documentType: 'CPF' }) }];
                }
                return [];
            }}
        />
    );
}

/* ======================================================================
 * CityPicker e CepField
 * ==================================================================== */

/** Cidade confirmada pela base do IBGE. */
export interface CityValue {
    city: string;
    state: string;
    ibgeCode: string;
}

interface CityOption {
    id: string;
    name: string;
    ibgeCode: string;
    state: { code: string; name: string };
}

export interface CityPickerProps {
    value: CityValue | null;
    onChange: (value: CityValue | null) => void;
    /** Limita a busca a uma UF. */
    state?: string;
    placeholder?: string;
    ariaLabel?: string;
    disabled?: boolean;
    invalid?: boolean;
    id?: string;
}

/** Busca cidade com código IBGE (7 dígitos). Só vale o que veio da lista; texto solto não vira valor. */
export function CityPicker({ value, onChange, state, placeholder = 'Digite a cidade', ariaLabel = 'Cidade', disabled, invalid, id }: CityPickerProps) {
    const [cleared, setCleared] = useState(false);
    if (value) {
        return (
            <SelectedBox
                title={`${value.city}, ${value.state}`}
                detail={`IBGE ${value.ibgeCode}`}
                disabled={disabled}
                invalid={invalid}
                onClear={() => {
                    setCleared(true);
                    onChange(null);
                }}
            />
        );
    }
    return (
        <SearchCombobox<CityOption>
            id={id}
            ariaLabel={ariaLabel}
            placeholder={placeholder}
            disabled={disabled}
            invalid={invalid}
            autoFocus={cleared}
            search={async (q) => {
                const response = await locationsApi.search({ q, state });
                return ((response.data ?? []) as CityOption[]).filter((city) => /^\d{7}$/.test(city.ibgeCode));
            }}
            itemKey={(city) => city.id}
            itemLabel={(city) => `${city.name}, ${city.state.code}`}
            renderItem={(city) => (
                <span className="block text-[14px] font-medium">
                    {city.name}, {city.state.code}
                </span>
            )}
            onSelect={(city) => onChange({ city: city.name, state: city.state.code, ibgeCode: city.ibgeCode })}
            emptyText={() => 'Nenhuma cidade encontrada. Confira o nome ou a UF.'}
        />
    );
}

/** Endereço devolvido pela consulta de CEP. */
export interface CepAddress {
    cep: string;
    street: string;
    neighborhood: string;
    city: string;
    state: string;
    ibgeCode: string;
}

export interface CepFieldProps {
    /** CEP, com ou sem máscara. */
    value: string;
    onChange: (cep: string) => void;
    /** Chamado quando o CEP de 8 dígitos foi consultado e o município está confirmado. */
    onResolve: (address: CepAddress) => void;
    ariaLabel?: string;
    disabled?: boolean;
    invalid?: boolean;
    id?: string;
}

/** Campo de CEP que consulta o endereço sozinho ao completar 8 dígitos. */
export function CepField({ value, onChange, onResolve, ariaLabel = 'CEP', disabled, invalid, id }: CepFieldProps) {
    const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const resolveRef = useRef(onResolve);
    resolveRef.current = onResolve;
    const digits = onlyDigits(value);

    useEffect(() => {
        if (digits.length !== 8) {
            setStatus('idle');
            setError('');
            return;
        }
        let current = true;
        setStatus('loading');
        setError('');
        const timer = window.setTimeout(async () => {
            try {
                const response = await locationsApi.getCEP(digits);
                if (!current) return;
                const data = response.data;
                if (!data?.cityIbgeCode || !data.cidade || !data.uf) throw new Error('CEP sem município confirmado. Escolha a cidade na busca.');
                resolveRef.current({ cep: digits, street: data.logradouro ?? '', neighborhood: data.bairro ?? '', city: data.cidade, state: data.uf, ibgeCode: data.cityIbgeCode });
                setStatus('done');
            } catch (cause) {
                if (!current) return;
                setError(cause instanceof Error && !('response' in cause) ? cause.message : formatApiError(cause));
                setStatus('error');
            }
        }, 300);
        return () => {
            current = false;
            window.clearTimeout(timer);
        };
    }, [digits, retry]);

    return (
        <div>
            <TextInput
                id={id}
                inputMode="numeric"
                autoComplete="postal-code"
                aria-label={ariaLabel}
                aria-invalid={invalid || status === 'error' || undefined}
                disabled={disabled}
                placeholder="00000-000"
                value={formatCep(value)}
                onChange={(event) => onChange(onlyDigits(event.target.value).slice(0, 8))}
            />
            {status === 'loading' ? (
                <p role="status" className="gx-muted mt-1 text-[12.5px]">
                    Consultando CEP…
                </p>
            ) : null}
            {status === 'done' ? (
                <p role="status" className="gx-muted mt-1 text-[12.5px]">
                    Endereço preenchido pelo CEP.
                </p>
            ) : null}
            {status === 'error' ? (
                <p role="alert" className="gx-red-text mt-1 text-[12.5px]">
                    {error}{' '}
                    <button type="button" className="gx-royal-text font-semibold underline" onClick={() => setRetry((n) => n + 1)}>
                        Tentar de novo
                    </button>
                </p>
            ) : null}
        </div>
    );
}

/* ======================================================================
 * Selects alimentados por useResource
 * ==================================================================== */

interface ResourceSelectProps<T> {
    /** Id escolhido (ou null). */
    value: string | null;
    onChange: (id: string | null, item: T | null) => void;
    resource: UseResourceResult<T[]>;
    getId: (item: T) => string;
    getLabel: (item: T) => string;
    /** Esconde itens fora da regra (inativos…), exceto o que já está escolhido. */
    isListed?: (item: T) => boolean;
    placeholder: string;
    /** Rótulo para "sem escolha" (ex.: "Todos os hubs"). Sem ele, o placeholder só aparece enquanto não há valor. */
    emptyOption?: string;
    emptyList: string;
    ariaLabel: string;
    disabled?: boolean;
    invalid?: boolean;
    id?: string;
    className?: string;
}

function ResourceSelect<T>({ value, onChange, resource, getId, getLabel, isListed, placeholder, emptyOption, emptyList, ariaLabel, disabled, invalid, id, className }: ResourceSelectProps<T>) {
    if (resource.data == null) {
        if (resource.error) return <ErrorState message={resource.error} onRetry={() => void resource.reload()} />;
        return (
            <SelectInput id={id} aria-label={ariaLabel} aria-busy="true" disabled className={className} value="">
                <option value="">Carregando…</option>
            </SelectInput>
        );
    }
    const items = resource.data.filter((item) => !isListed || isListed(item) || getId(item) === value);
    return (
        <>
            <SelectInput
                id={id}
                aria-label={ariaLabel}
                aria-invalid={invalid || undefined}
                disabled={disabled || items.length === 0}
                className={className}
                value={value ?? ''}
                onChange={(event) => {
                    const next = event.target.value;
                    onChange(next || null, items.find((item) => getId(item) === next) ?? null);
                }}
            >
                {items.length === 0 ? (
                    <option value="">{emptyList}</option>
                ) : (
                    <>
                        {emptyOption || !value ? <option value="">{emptyOption ?? placeholder}</option> : null}
                        {items.map((item) => (
                            <option key={getId(item)} value={getId(item)}>
                                {getLabel(item)}
                            </option>
                        ))}
                    </>
                )}
            </SelectInput>
            {resource.error ? <p className="gx-yellow-text mt-1 text-[12.5px]">{resource.error} Mostrando a última lista carregada.</p> : null}
        </>
    );
}

type SelectBase<T> = {
    value: string | null;
    onChange: (id: string | null, item: T | null) => void;
    placeholder?: string;
    emptyOption?: string;
    disabled?: boolean;
    invalid?: boolean;
    id?: string;
    className?: string;
    ariaLabel?: string;
};

/** Hubs ativos (cache `hubs`, o mesmo de `KEYS.hubs`). */
export function HubSelect({ placeholder = 'Selecione o hub', ariaLabel = 'Hub', ...rest }: SelectBase<Hub>) {
    const resource = useResource<Hub[]>('hubs', async () => (await hubsApi.list()).data ?? [], { staleMs: 300_000 });
    return <ResourceSelect {...rest} resource={resource} getId={(h) => h.id} getLabel={(h) => `${h.name} (${h.code})`} isListed={(h) => h.active} placeholder={placeholder} emptyList="Nenhum hub cadastrado" ariaLabel={ariaLabel} />;
}

/** Transportadores aprovados e ativos (cache `links:approved`). */
export function CarrierSelect({ placeholder = 'Selecione o transportador', ariaLabel = 'Transportador', ...rest }: SelectBase<Link>) {
    const resource = useResource<Link[]>('links:approved', async () => (await linksApi.list({ approvalStatus: 'APPROVED' })).data ?? [], { staleMs: 60_000 });
    return (
        <ResourceSelect
            {...rest}
            resource={resource}
            getId={(l) => l.id}
            getLabel={(l) => (l.vehiclePlate ? `${l.name} · ${l.vehiclePlate}` : l.name)}
            isListed={(l) => l.active}
            placeholder={placeholder}
            emptyList="Nenhum transportador aprovado"
            ariaLabel={ariaLabel}
        />
    );
}

/** Tipos de veículo ativos (cache `vehicle-types`). */
export function VehicleTypeSelect({ placeholder = 'Selecione o tipo de veículo', ariaLabel = 'Tipo de veículo', ...rest }: SelectBase<VehicleType>) {
    const resource = useResource<VehicleType[]>('vehicle-types', async () => (await vehicleTypesApi.list()).data ?? [], { staleMs: 300_000 });
    return <ResourceSelect {...rest} resource={resource} getId={(v) => v.id} getLabel={(v) => v.name} isListed={(v) => v.active} placeholder={placeholder} emptyList="Nenhum tipo de veículo cadastrado" ariaLabel={ariaLabel} />;
}

/** Clientes (cache `clients:all`). */
export function ClientSelect({ placeholder = 'Selecione o cliente', ariaLabel = 'Cliente', ...rest }: SelectBase<Client>) {
    const resource = useResource<Client[]>('clients:all', async () => (await clientsApi.list()).data ?? [], { staleMs: 120_000 });
    return (
        <ResourceSelect
            {...rest}
            resource={resource}
            getId={(c) => c.id}
            getLabel={(c) => (c.document ? `${c.companyName} · ${formatCnpjCpf(c.document)}` : c.companyName)}
            placeholder={placeholder}
            emptyList="Nenhum cliente cadastrado"
            ariaLabel={ariaLabel}
        />
    );
}

/** Emitentes fiscais (cache `fiscal-emitters`). `hubId` filtra na tela, sem mudar a chave. */
export function FiscalEmitterSelect({ hubId, placeholder = 'Selecione o emitente', ariaLabel = 'Emitente fiscal', ...rest }: SelectBase<FiscalEmitter> & { hubId?: string | null }) {
    const resource = useResource<FiscalEmitter[]>('fiscal-emitters', async () => (await fiscalEmittersApi.list()).data ?? [], { staleMs: 120_000 });
    return (
        <ResourceSelect
            {...rest}
            resource={resource}
            getId={(e) => e.id}
            getLabel={(e) => e.displayName || e.tradeName || e.person?.tradeName || e.person?.legalName || 'Emitente sem nome'}
            isListed={(e) => !hubId || e.hubId === hubId}
            placeholder={placeholder}
            emptyList="Nenhum emitente fiscal cadastrado"
            ariaLabel={ariaLabel}
        />
    );
}
