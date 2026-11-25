import React, { useState } from 'react';
import type { ConsolidationQueueGroup } from '../../../../../types/index';
import { kg } from '../../../lib/format';
import { Button, Pill } from '../../../ui/kit';

export type RouteBreakdownItem = NonNullable<ConsolidationQueueGroup['routeBreakdown']>[number];

const MAX_CITIES = 4;
const m3 = (value: number) => `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m³`;

interface Props {
    items: ConsolidationQueueGroup['routeBreakdown'];
    /** Pedidos que já estão na viagem aberta: itens só com eles não aparecem. */
    inTrip?: ReadonlySet<unknown>;
    /** Desabilita a ação da linha. */
    disabled?: boolean;
    /** Chave do item em andamento (mostra o carregando). */
    busyKey?: string | null;
    /** Rótulo do botão da linha (ex.: "Incluir esta rota na viagem"). */
    actionLabel: string;
    /** Rótulo do botão de confirmação. */
    confirmLabel: string;
    /** Pergunta de confirmação; recebe a contagem e o nome ("Rota X" ou "carga sem rota"). */
    confirmText: (count: number, routeName: string) => string;
    onAction: (item: RouteBreakdownItem) => void | Promise<unknown>;
}

/** Quebra da carga de um grupo da fila por rota do hub final. Informação + atalho: quem decide é o operador. */
export const RouteBreakdown: React.FC<Props> = ({ items, inTrip, disabled, busyKey, actionLabel, confirmLabel, confirmText, onAction }) => {
    const [armed, setArmed] = useState<string | null>(null);
    const rows = (items ?? []).filter((item) => !item.orderIds.length || item.orderIds.some((id) => !inTrip?.has(id)));
    if (!rows.length) return null;

    if (rows.length === 1 && rows[0].routeId === null) {
        return (
            <p className="gx-rb-hint gx-muted">
                Cadastre as rotas do hub {rows[0].finalHubName} para quebrar a carga por linha.
            </p>
        );
    }

    const total = rows.reduce((sum, item) => sum + (item.weightKg || 0), 0);

    return (
        <ul className="gx-rb" aria-label="Quebra da carga por rota">
            {rows.map((item) => {
                const title = `${item.routeName ?? 'Sem rota cadastrada'} · ${item.finalHubName}`;
                const pct = total > 0 ? Math.max(3, Math.round((item.weightKg / total) * 100)) : 0;
                const shown = item.cities.slice(0, MAX_CITIES);
                const extra = item.cities.length - shown.length;
                const open = armed === item.key;
                const count = item.orderCount;
                return (
                    <li key={item.key} className="gx-rb-row">
                        <div className="gx-rb-head">
                            <span className="gx-rb-title">{title}</span>
                            <span className="gx-rb-weight">{kg(item.weightKg)}</span>
                        </div>
                        <div className="gx-rb-bar" role="presentation">
                            <span style={{ width: `${pct}%` }} />
                        </div>
                        <p className="gx-rb-meta gx-muted">
                            {count} {count === 1 ? 'pedido' : 'pedidos'} · {kg(item.weightKg)} · {m3(item.volumeM3)}
                        </p>
                        {shown.length ? (
                            <div className="gx-rb-cities">
                                {shown.map((city) => (
                                    <span key={city} className="gx-rb-city">{city}</span>
                                ))}
                                {extra > 0 ? <span className="gx-rb-city gx-rb-more">+{extra}</span> : null}
                            </div>
                        ) : null}
                        {item.ambiguous ? (
                            <p className="gx-rb-flag">
                                <Pill tone="yellow">Cidade em 2+ rotas</Pill>
                            </p>
                        ) : null}
                        <div className="gx-rb-act">
                            {open ? (
                                <>
                                    <span className="gx-rb-ask">
                                        {confirmText(item.orderIds.length ? item.orderIds.filter((id) => !inTrip?.has(id)).length : count, item.routeName ? `Rota ${item.routeName}` : 'carga sem rota')}
                                    </span>
                                    <Button
                                        size="sm"
                                        variant="primary"
                                        disabled={disabled}
                                        loading={busyKey === item.key}
                                        onClick={async () => {
                                            await onAction(item);
                                            setArmed(null);
                                        }}
                                    >
                                        {confirmLabel}
                                    </Button>
                                    <Button size="sm" onClick={() => setArmed(null)}>
                                        Voltar
                                    </Button>
                                </>
                            ) : (
                                <Button size="sm" disabled={disabled} onClick={() => setArmed(item.key)}>
                                    {actionLabel}
                                </Button>
                            )}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
};
