import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { IconArrowRight, IconArrowUpRight, IconSearch } from './icons';
import { LAYER_ID } from './overlay';

/**
 * Busca universal (Ctrl K): chega a qualquer área da torre ou leva o texto digitado para a
 * busca de pedidos ou de viagens. É o atalho do Copilot: mínimo de cliques até o lugar certo.
 */

interface Command {
    id: string;
    label: string;
    hint: string;
    to: string;
    keywords: string;
    external?: boolean;
}

const COMMANDS: Command[] = [
    { id: 'hoje', label: 'Hoje', hint: 'O que precisa de você e o que o sistema resolveu', to: '/gestaos', keywords: 'inicio central excecoes autopilot copilot' },
    { id: 'viagens', label: 'Viagens', hint: 'Acompanhar viagens e documentos', to: '/gestaos/viagens', keywords: 'manifesto mdfe ciot transferencia entrega' },
    { id: 'pedidos', label: 'Pedidos', hint: 'Localizar carga e rastrear', to: '/gestaos/pedidos', keywords: 'carga rastreio nf nota cte' },
    { id: 'faturar', label: 'Financeiro · A faturar', hint: 'Fretes emitidos sem fatura', to: '/gestaos/financeiro?aba=faturar', keywords: 'fatura cobranca receber' },
    { id: 'receber', label: 'Financeiro · A receber', hint: 'Faturas e recebimentos', to: '/gestaos/financeiro?aba=receber', keywords: 'fatura baixa recebimento' },
    { id: 'pagar', label: 'Financeiro · A pagar', hint: 'Títulos de transportadores', to: '/gestaos/financeiro?aba=pagar', keywords: 'titulo pagamento carta frete acerto' },
    { id: 'hubs', label: 'Rede · Hubs', hint: 'Estoque e situação de cada hub', to: '/gestaos/rede?aba=hubs', keywords: 'filial cd deposito cobertura' },
    { id: 'carriers', label: 'Rede · Transportadores', hint: 'Aprovar e acompanhar transportadores', to: '/gestaos/rede?aba=transportadores', keywords: 'link motorista aprovacao' },
    { id: 'comercial', label: 'Comercial', hint: 'Demandas e cotações', to: '/gestaos/comercial', keywords: 'cotacao demanda cliente oportunidade' },
    { id: 'sistema', label: 'Sistema', hint: 'Como a torre trabalha e saúde fiscal', to: '/gestaos/sistema', keywords: 'configuracao fiscal emitente autopilot fila' },
    { id: 'os', label: 'Abrir a operação do hub', hint: 'TSM O.S. — receber, montar viagem, entregar', to: '/hubs', keywords: 'os operacao hub estacao', external: true },
    { id: 'classica', label: 'Gestão clássica', hint: 'Painel anterior, com todos os cadastros', to: '/gestao', keywords: 'antigo legado torre cadastro', external: true },
];

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const CommandPalette: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [index, setIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        setQuery('');
        setIndex(0);
        const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
        return () => window.clearTimeout(timer);
    }, [open]);

    const results = useMemo<Command[]>(() => {
        const text = query.trim();
        const needle = normalize(text);
        const matches = needle ? COMMANDS.filter((c) => normalize(`${c.label} ${c.hint} ${c.keywords}`).includes(needle)) : COMMANDS;
        if (!text) return matches;
        const encoded = encodeURIComponent(text);
        return [
            { id: 'q-pedido', label: `Buscar pedido "${text}"`, hint: 'Número, nota fiscal, cliente, origem ou destino', to: `/gestaos/pedidos?q=${encoded}`, keywords: '' },
            { id: 'q-viagem', label: `Buscar viagem "${text}"`, hint: 'Rota, transportador, placa ou código', to: `/gestaos/viagens?q=${encoded}`, keywords: '' },
            ...matches,
        ];
    }, [query]);

    useEffect(() => setIndex(0), [query]);

    const layer = typeof document !== 'undefined' ? document.getElementById(LAYER_ID) : null;
    if (!open || !layer) return null;

    const go = (command: Command | undefined) => {
        if (!command) return;
        onClose();
        navigate(command.to);
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') onClose();
        else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIndex((current) => Math.min(results.length - 1, current + 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIndex((current) => Math.max(0, current - 1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            go(results[index]);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" onKeyDown={onKeyDown}>
            <button type="button" aria-label="Fechar busca" className="gx-fade absolute inset-0 cursor-default border-0" style={{ background: 'var(--gx-scrim)' }} onClick={onClose} />
            <div role="dialog" aria-modal="true" aria-label="Busca da torre" className="gx-glass gx-glass-strong gx-glass-float gx-pop relative w-full max-w-[620px] overflow-hidden">
                <div className="gx-hair-b flex items-center gap-3 px-5">
                    <IconSearch className="gx-muted flex-none" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Ir para uma área, ou digitar pedido, nota, rota, placa…"
                        aria-label="Buscar"
                        className="h-14 w-full border-0 bg-transparent text-[16px] outline-none"
                        style={{ color: 'var(--gx-ink)' }}
                    />
                    <span className="gx-kbd flex-none">Esc</span>
                </div>
                <ul className="max-h-[52vh] overflow-y-auto p-2" role="listbox" aria-label="Resultados">
                    {results.map((command, position) => (
                        <li key={command.id} role="option" aria-selected={position === index}>
                            <button
                                type="button"
                                className="gx-row flex items-center gap-3"
                                aria-current={position === index}
                                onMouseEnter={() => setIndex(position)}
                                onClick={() => go(command)}
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate font-semibold">{command.label}</span>
                                    <span className="gx-muted block truncate text-[12.5px]">{command.hint}</span>
                                </span>
                                {command.external ? <IconArrowUpRight size={16} className="gx-muted flex-none" /> : <IconArrowRight size={16} className="gx-muted flex-none" />}
                            </button>
                        </li>
                    ))}
                    {results.length === 0 ? <li className="gx-muted px-4 py-6 text-center text-[13.5px]">Nada encontrado.</li> : null}
                </ul>
            </div>
        </div>,
        layer,
    );
};
