import React from 'react';
import type { OrderListItem } from '../../../../types/index';
import { relative } from '../../lib/format';
import { orderStatusLabel, orderStatusTone, orderWhere, placeOf } from '../../lib/pedidos';
import { Pill } from '../../ui/kit';

/** Tabela de pedidos: onde está a carga e quem recebe. Clique na linha abre a gaveta. */
export const OrderTable: React.FC<{ orders: OrderListItem[]; selectedId: string | null; onOpen: (id: string) => void }> = ({ orders, selectedId, onOpen }) => (
    <div className="gx-scroll-x">
        <table className="gx-table">
            <thead>
                <tr>
                    <th>Pedido</th>
                    <th>NF</th>
                    <th>Cliente</th>
                    <th>Remetente → destinatário</th>
                    <th>Onde está</th>
                    <th>Situação</th>
                    <th>Atualizado</th>
                </tr>
            </thead>
            <tbody>
                {orders.map((order) => {
                    const origin = placeOf(order.remetentePerson, order.demand?.origin);
                    const destination = placeOf(order.destinatarioPerson, order.demand?.destination);
                    const open = () => onOpen(order.id);
                    return (
                        <tr
                            key={order.id}
                            data-clickable="true"
                            aria-selected={order.id === selectedId}
                            tabIndex={0}
                            onClick={open}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    open();
                                }
                            }}
                            style={order.id === selectedId ? { background: 'var(--gx-glass-strong)' } : undefined}
                        >
                            <td className="gx-num whitespace-nowrap text-[15px]">{order.demand?.orderNumber != null ? `#${order.demand.orderNumber}` : '—'}</td>
                            <td className="gx-mono whitespace-nowrap text-[13px]">{order.nfNumber || order.demand?.nfNumber || '—'}</td>
                            <td className="max-w-[220px] truncate">{order.demand?.client?.companyName ?? '—'}</td>
                            <td className="whitespace-nowrap">
                                <span className="gx-soft">{origin}</span> <span className="gx-muted">→</span> <span className="font-medium">{destination}</span>
                            </td>
                            <td className="whitespace-nowrap">{orderWhere(order)}</td>
                            <td>
                                <Pill tone={orderStatusTone(order.status)}>{orderStatusLabel(order.status)}</Pill>
                            </td>
                            <td className="gx-muted whitespace-nowrap text-[13px]">{relative(order.updatedAt)}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    </div>
);
