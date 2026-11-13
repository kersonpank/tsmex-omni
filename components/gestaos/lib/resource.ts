import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { formatApiError } from '../../../lib/api';

/**
 * Cache de leitura da Gestão V2, por chave. Várias telas usam os mesmos dados (viagens, exceções,
 * títulos); cada chave é buscada uma vez, reaproveitada na navegação e renovada em segundo plano.
 * Resposta atrasada de uma busca antiga nunca sobrescreve a mais nova.
 */

export interface ResourceState<T> {
    data: T | null;
    error: string | null;
    loading: boolean;
    loadedAt: number | null;
}

const EMPTY: ResourceState<unknown> = { data: null, error: null, loading: false, loadedAt: null };

const store = new Map<string, ResourceState<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const loaders = new Map<string, () => Promise<unknown>>();
const inflight = new Map<string, Promise<void>>();
const tokens = new Map<string, number>();

function write(key: string, patch: Partial<ResourceState<unknown>>) {
    store.set(key, { ...(store.get(key) ?? EMPTY), ...patch });
    listeners.get(key)?.forEach((notify) => notify());
}

/** Busca a chave agora. Chamadas simultâneas para a mesma chave dividem a mesma requisição. */
export function loadResource<T>(key: string, loader: () => Promise<T>): Promise<void> {
    const running = inflight.get(key);
    if (running) return running;
    const token = (tokens.get(key) ?? 0) + 1;
    tokens.set(key, token);
    write(key, { loading: true });
    const request = loader()
        .then(
            (data) => {
                if (tokens.get(key) === token) write(key, { data, error: null, loading: false, loadedAt: Date.now() });
            },
            (error) => {
                if (tokens.get(key) === token) write(key, { error: formatApiError(error), loading: false });
            },
        )
        .finally(() => {
            if (inflight.get(key) === request) inflight.delete(key);
        });
    inflight.set(key, request);
    return request;
}

/** Descarta a busca em andamento (se houver) e busca de novo. */
function forceReload(key: string): Promise<void> {
    const loader = loaders.get(key);
    if (!loader) return Promise.resolve();
    inflight.delete(key);
    return loadResource(key, loader);
}

/**
 * Depois de uma ação que muda dados: renova as chaves que começam com o prefixo.
 * Quem está na tela recarrega já; o resto fica marcado como velho e recarrega ao abrir.
 */
export function invalidate(...prefixes: string[]): void {
    for (const key of new Set([...store.keys(), ...loaders.keys()])) {
        if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
        if (listeners.get(key)?.size) void forceReload(key);
        else if (store.has(key)) write(key, { loadedAt: null });
    }
}

/** Esvazia tudo (troca de usuário, saída da Gestão V2, testes). */
export function clearResources(): void {
    store.clear();
    loaders.clear();
    inflight.clear();
    tokens.clear();
    listeners.forEach((set) => set.forEach((notify) => notify()));
}

export function peekResource<T>(key: string): ResourceState<T> {
    return (store.get(key) ?? EMPTY) as ResourceState<T>;
}

export interface UseResourceResult<T> {
    data: T | null;
    error: string | null;
    /** Primeira carga, ainda sem dado para mostrar. */
    loading: boolean;
    /** Já há dado na tela e uma atualização está em andamento. */
    refreshing: boolean;
    loadedAt: number | null;
    reload: () => Promise<void>;
}

/**
 * @param key      chave do cache; `null` desliga a busca.
 * @param loader   função que busca o dado.
 * @param options  `staleMs`: idade a partir da qual o dado é renovado ao montar (padrão 20 s);
 *                 `refreshMs`: renovação periódica enquanto a aba está visível.
 */
export function useResource<T>(
    key: string | null,
    loader: () => Promise<T>,
    options: { staleMs?: number; refreshMs?: number } = {},
): UseResourceResult<T> {
    const loaderRef = useRef(loader);
    loaderRef.current = loader;
    const { staleMs = 20_000, refreshMs } = options;

    const subscribe = useCallback(
        (notify: () => void) => {
            if (!key) return () => undefined;
            let set = listeners.get(key);
            if (!set) {
                set = new Set();
                listeners.set(key, set);
            }
            set.add(notify);
            return () => {
                set!.delete(notify);
            };
        },
        [key],
    );
    const snapshot = useSyncExternalStore(subscribe, () => (key ? store.get(key) ?? EMPTY : EMPTY)) as ResourceState<T>;

    useEffect(() => {
        if (!key) return;
        loaders.set(key, () => loaderRef.current());
        const entry = store.get(key);
        if (!entry?.loadedAt || Date.now() - entry.loadedAt > staleMs) void loadResource(key, () => loaderRef.current());
    }, [key, staleMs]);

    useEffect(() => {
        if (!key || !refreshMs) return;
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') void forceReload(key);
        }, refreshMs);
        return () => window.clearInterval(timer);
    }, [key, refreshMs]);

    const reload = useCallback(() => (key ? forceReload(key) : Promise.resolve()), [key]);

    return {
        data: snapshot.data,
        error: snapshot.error,
        loading: snapshot.loading && snapshot.data == null,
        refreshing: snapshot.loading && snapshot.data != null,
        loadedAt: snapshot.loadedAt,
        reload,
    };
}
