import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { formatApiError } from '../../../lib/api';
import { IconAlert, IconCheck, IconClose } from './icons';

/**
 * Camada flutuante da Gestão V2: gaveta lateral e avisos.
 * Tudo que flutua é montado em `#gx-layer` (irmão do conteúdo, dentro de `.gx`): um elemento
 * `position: fixed` dentro de um painel com `backdrop-filter` ficaria preso ao painel.
 */

export const LAYER_ID = 'gx-layer';

function useLayer(): HTMLElement | null {
    const [layer, setLayer] = useState<HTMLElement | null>(null);
    useEffect(() => setLayer(document.getElementById(LAYER_ID)), []);
    return layer;
}

/* ---------- Gaveta ---------- */

export interface DrawerProps {
    open: boolean;
    onClose: () => void;
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    /** Selo ou pílula ao lado do título. */
    badge?: React.ReactNode;
    /** Ações fixas no rodapé. */
    footer?: React.ReactNode;
    /** Largura máxima em px (padrão 560). */
    width?: number;
    children: React.ReactNode;
}

/** Detalhe ao lado da lista: o operador não perde o lugar onde estava. Esc e clique fora fecham. */
export const Drawer: React.FC<DrawerProps> = ({ open, onClose, title, subtitle, badge, footer, width = 560, children }) => {
    const layer = useLayer();
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const previous = document.activeElement as HTMLElement | null;
        panelRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            previous?.focus?.();
        };
    }, [open, onClose]);

    if (!open || !layer) return null;
    return createPortal(
        <div className="fixed inset-0 z-50 flex justify-end">
            <button type="button" aria-label="Fechar" className="gx-fade absolute inset-0 cursor-default border-0" style={{ background: 'var(--gx-scrim)' }} onClick={onClose} />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="gx-glass gx-glass-strong gx-glass-float gx-slide-in relative m-3 flex w-full flex-col outline-none"
                style={{ maxWidth: width }}
            >
                <header className="gx-hair-b flex items-start justify-between gap-3 px-6 pb-4 pt-5">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2.5">
                            <h2 className="text-[20px] font-bold leading-tight tracking-[-0.02em]">{title}</h2>
                            {badge}
                        </div>
                        {subtitle ? <p className="gx-muted mt-1 text-[13.5px]">{subtitle}</p> : null}
                    </div>
                    <button type="button" className="gx-icon-btn -mr-2 -mt-1 flex-none" aria-label="Fechar" onClick={onClose}>
                        <IconClose />
                    </button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
                {footer ? <footer className="gx-hair-t flex flex-wrap items-center gap-2.5 px-6 py-4">{footer}</footer> : null}
            </div>
        </div>,
        layer,
    );
};

/* ---------- Avisos ---------- */

type ToastKind = 'success' | 'error';
interface ToastItem {
    id: number;
    kind: ToastKind;
    message: string;
}

export interface ToastApi {
    success: (message: string) => void;
    error: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({ success: () => undefined, error: () => undefined });

/** Confirmação curta de uma ação. Erro fica mais tempo na tela. */
export function useToast(): ToastApi {
    return useContext(ToastContext);
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [items, setItems] = useState<ToastItem[]>([]);
    const layer = useLayer();
    const seq = useRef(0);

    const push = useCallback((kind: ToastKind, message: string) => {
        const id = ++seq.current;
        setItems((current) => [...current.slice(-3), { id, kind, message }]);
        window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), kind === 'error' ? 8000 : 4200);
    }, []);

    const api = useMemo<ToastApi>(() => ({ success: (message) => push('success', message), error: (message) => push('error', message) }), [push]);

    return (
        <ToastContext.Provider value={api}>
            {children}
            {layer
                ? createPortal(
                      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
                          {items.map((item) => (
                              <div
                                  key={item.id}
                                  role={item.kind === 'error' ? 'alert' : 'status'}
                                  className="gx-glass gx-glass-strong gx-glass-float gx-pop pointer-events-auto flex max-w-[560px] items-start gap-3 px-4 py-3 text-[14px]"
                                  style={{ borderRadius: 16 }}
                              >
                                  {item.kind === 'error' ? <IconAlert className="gx-red-text mt-0.5 flex-none" /> : <IconCheck className="gx-royal-text mt-0.5 flex-none" />}
                                  <span className={clsx('min-w-0', item.kind === 'error' && 'font-medium')}>{item.message}</span>
                                  <button
                                      type="button"
                                      className="gx-muted -mr-1 flex-none border-0 bg-transparent p-0.5"
                                      aria-label="Dispensar aviso"
                                      onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
                                  >
                                      <IconClose size={15} />
                                  </button>
                              </div>
                          ))}
                      </div>,
                      layer,
                  )
                : null}
        </ToastContext.Provider>
    );
};

/* ---------- Ação com retorno ---------- */

/**
 * Roda uma ação de escrita: trava o botão enquanto roda (nada de envio duplo), avisa o
 * resultado e devolve `true` em caso de sucesso. `busy` guarda a chave da ação em andamento.
 */
export function useAction(): {
    busy: string | null;
    run: (key: string, action: () => Promise<unknown>, messages: { success: string; error?: string }) => Promise<boolean>;
} {
    const toast = useToast();
    const [busy, setBusy] = useState<string | null>(null);
    const running = useRef(false);

    const run = useCallback(
        async (key: string, action: () => Promise<unknown>, messages: { success: string; error?: string }) => {
            if (running.current) return false;
            running.current = true;
            setBusy(key);
            try {
                await action();
                toast.success(messages.success);
                return true;
            } catch (error) {
                toast.error(`${messages.error ?? 'A ação não foi concluída.'} ${formatApiError(error)}`);
                return false;
            } finally {
                running.current = false;
                setBusy(null);
            }
        },
        [toast],
    );

    return { busy, run };
}
