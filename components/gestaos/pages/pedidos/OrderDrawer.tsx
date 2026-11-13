import React from 'react';
import { Link } from 'react-router-dom';
import type { OrderListItem } from '../../../../types/index';
import { dateTime, kg, money } from '../../lib/format';
import { orderStatusLabel, orderStatusTone, orderWhere, placeOf } from '../../lib/pedidos';
import { Kv, Pill } from '../../ui/kit';
import { Drawer } from '../../ui/overlay';
import { OrderTrace } from './OrderTrace';

/** Gaveta do pedido: resumo e rastreio. Trocar status é do hub, não daqui. */
export const OrderDrawer: React.FC<{ orderId: string | null; row: OrderListItem | null; onClose: () => void }> = ({ orderId, row, onClose }) => (
    <Drawer
        open={Boolean(orderId)}
        onClose={onClose}
        width={600}
        title={row?.demand?.orderNumber != null ? `Pedido #${row.demand.orderNumber}` : 'Pedido'}
        subtitle={row ? `${row.demand?.client?.companyName ?? 'Cliente não informado'}${row.nfNumber || row.demand?.nfNumber ? ` · NF ${row.nfNumber || row.demand?.nfNumber}` : ''}` : null}
        badge={row ? <Pill tone={orderStatusTone(row.status)}>{orderStatusLabel(row.status)}</Pill> : null}
        footer={
            orderId ? (
                <>
                    <Link to={`/orders/${orderId}`} className="gx-btn gx-btn-soft">
                        Abrir pedido completo
                    </Link>
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
                <OrderTrace orderId={orderId} />
            </div>
        ) : null}
    </Drawer>
);
