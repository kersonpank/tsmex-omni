import React from 'react';
import { Link } from 'react-router-dom';
import type { OrderListItem } from '../../../../types/index';
import { dateTime, kg, money } from '../../lib/format';
import { orderStatusLabel, orderStatusTone, orderWhere, placeOf } from '../../lib/pedidos';
import { Kv, Pill } from '../../ui/kit';
import { Drawer } from '../../ui/overlay';
import { FreightSection } from './frete/FreightSection';
import { OrderAttachments } from './OrderAttachments';
import { OrderNote } from './OrderNote';
import { OrderPackages } from './OrderPackages';
import { OrderStatusChange } from './OrderStatusChange';
import { OrderTrace } from './OrderTrace';
import { OrderTrackingLink } from './OrderTrackingLink';

/** Gaveta do pedido: resumo, frete, status, volumes, anexos, nota e rastreio. Só a conferência física fica no hub. */
export const OrderDrawer: React.FC<{ orderId: string | null; row: OrderListItem | null; onClose: () => void }> = ({ orderId, row, onClose }) => {
    // Só pedido parado num hub (ou ainda pendente) entra numa viagem nova.
    const canPlan = row ? ['PENDING', 'AT_HUB'].includes(row.status) : false;
    return (
        <Drawer
            open={Boolean(orderId)}
            onClose={onClose}
            width={720}
            title={row?.demand?.orderNumber != null ? `Pedido #${row.demand.orderNumber}` : 'Pedido'}
            subtitle={row ? `${row.demand?.client?.companyName ?? 'Cliente não informado'}${row.nfNumber || row.demand?.nfNumber ? ` · NF ${row.nfNumber || row.demand?.nfNumber}` : ''}` : null}
            badge={row ? <Pill tone={orderStatusTone(row.status)}>{orderStatusLabel(row.status)}</Pill> : null}
            footer={
                orderId ? (
                    <>
                        <Link to={`/gestaos/pedidos/${orderId}/editar`} className="gx-btn gx-btn-primary">
                            Editar
                        </Link>
                        {canPlan ? (
                            <Link to={`/gestaos/viagens/nova?orders=${orderId}`} className="gx-btn gx-btn-soft">
                                Montar viagem com este pedido
                            </Link>
                        ) : null}
                        <Link to={`/hubs/pedidos/${orderId}`} className="gx-btn gx-btn-ghost">
                            Abrir no hub
                        </Link>
                    </>
                ) : null
            }
        >
            {orderId ? (
                <div className="flex flex-col gap-4">
                    {row ? (
                        <section className="gx-inset px-4 py-3.5">
                            <h3 className="gx-label mb-1">Resumo</h3>
                            <Kv label="Remetente" value={`${row.remetentePerson?.legalName ?? '—'} · ${placeOf(row.remetentePerson, row.demand?.origin)}`} />
                            <Kv label="Destinatário" value={`${row.destinatarioPerson?.legalName ?? '—'} · ${placeOf(row.destinatarioPerson, row.demand?.destination)}`} />
                            <Kv label="Onde está" value={orderWhere(row)} />
                            <Kv label="Peso" value={kg(row.demand?.weight)} />
                            <Kv label="Valor da nota" value={money(row.demand?.nfValue)} />
                            <Kv label="Criado em" value={dateTime(row.createdAt)} />
                        </section>
                    ) : null}
                    <FreightSection orderId={orderId} />
                    {row ? <OrderStatusChange key={`${orderId}:${row.status}`} orderId={orderId} status={row.status} currentHubId={row.currentHubId} /> : null}
                    <OrderPackages orderId={orderId} expectedUnits={row?.demand?.units} />
                    <OrderAttachments orderId={orderId} />
                    <OrderNote orderId={orderId} />
                    {row ? <OrderTrackingLink order={row} /> : null}
                    <OrderTrace orderId={orderId} />
                </div>
            ) : null}
        </Drawer>
    );
};
