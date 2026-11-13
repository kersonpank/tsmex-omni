import React from 'react';
import { useParams } from 'react-router-dom';
import { ordersApi } from '../../../../lib/api';
import { shortId } from '../../lib/format';
import { useResource } from '../../lib/resource';
import { LinkButton } from '../../ui/form';
import { Loadable, PageHeader, Skeleton } from '../../ui/kit';
import { OrderEditor, type OrderDetail } from './OrderEditor';

/** Pedido: entrada de carga (novo) e edição (`/pedidos/:orderId/editar`) na mesma tela. */
const OrderFormPage: React.FC = () => {
    const { orderId } = useParams<{ orderId?: string }>();
    const detail = useResource<(OrderDetail & { demand?: { orderNumber?: number | null } }) | null>(
        orderId ? `orders:detail:${orderId}` : null,
        async () => ((await ordersApi.getById(orderId!)) as { data?: OrderDetail }).data ?? null,
        { staleMs: 0 },
    );

    if (!orderId) {
        return (
            <>
                <PageHeader
                    title="Novo pedido"
                    question="Qual carga chegou, de quem, para quem, e quem paga o frete?"
                    actions={<LinkButton to="/gestaos/pedidos">Voltar aos pedidos</LinkButton>}
                />
                <OrderEditor order={null} />
            </>
        );
    }

    const number = detail.data?.demand?.orderNumber;
    return (
        <>
            <PageHeader
                title={number != null ? `Editar pedido #${number}` : `Editar pedido ${shortId(orderId)}`}
                question="O que mudou nas pessoas, nas notas ou na coleta?"
                actions={<LinkButton to={`/gestaos/pedidos?p=${orderId}`}>Voltar ao pedido</LinkButton>}
            />
            <Loadable state={detail} skeleton={<Skeleton rows={6} height={56} />}>
                {(order) => (order ? <OrderEditor key={order.id} order={order} /> : <p className="gx-muted">Pedido não encontrado.</p>)}
            </Loadable>
        </>
    );
};

export default OrderFormPage;
