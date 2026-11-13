import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { invoicesApi, type InvoiceableOrder } from '../../../../lib/api';
import { useAction } from '../../ui/overlay';
import { Button, EmptyState, Field, Loadable, ModeBadge, Panel, TextInput } from '../../ui/kit';
import { money, plural } from '../../lib/format';
import { BLOCK_REASON, dueDateIso, fromCents, groupByPayer, splitEligible, sumCents, type PayerGroup } from '../../lib/financeiro';
import { invalidate } from '../../lib/resource';
import { KEYS } from '../../lib/data';
import { useEligibleOrders } from './useFinanceiro';

type BillableOrder = PayerGroup['orders'][number];
type BlockedOrder = Extract<InvoiceableOrder, { billable: false }>;

const orderLabel = (order: { id: string; nfNumber?: string | null }) => (order.nfNumber ? `NF ${order.nfNumber}` : `Pedido ${order.id.slice(0, 8).toUpperCase()}`);

const GroupCard: React.FC<{ group: PayerGroup; dueDate: string; busy: string | null; run: ReturnType<typeof useAction>['run'] }> = ({ group, dueDate, busy, run }) => {
    const [excluded, setExcluded] = useState<Set<string>>(new Set());
    const [open, setOpen] = useState(false);
    const chosen = group.orders.filter((order) => !excluded.has(order.id));
    const totalCents = sumCents(chosen.map((order) => order.amount));
    const key = `bill:${group.accountId}`;

    const toggle = (id: string) =>
        setExcluded((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const bill = async () => {
        if (!chosen.length) return;
        const iso = dueDate ? dueDateIso(dueDate) : undefined;
        const done = await run(
            key,
            async () => {
                // Uma fatura por pedido avulso; dois ou mais do mesmo pagador viram uma fatura só.
                if (chosen.length === 1) await invoicesApi.create({ orderId: chosen[0].id, accountId: group.accountId, ...(iso ? { dueDate: iso } : {}) });
                else await invoicesApi.createGroup(group.accountId, chosen.map((order) => order.id), iso);
            },
            { success: chosen.length === 1 ? 'Fatura criada.' : `Fatura criada com ${chosen.length} pedidos.`, error: 'A fatura não foi criada.' },
        );
        // Mesmo com erro, o servidor pode ter faturado parte: renova para a tela dizer a verdade.
        invalidate('invoices:', KEYS.unbilled);
        if (done) setExcluded(new Set());
    };

    return (
        <li className="gx-inset p-4">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <div className="min-w-0">
                    <p className="truncate font-semibold">{group.name}</p>
                    <p className="gx-muted text-[13px]">
                        {plural(group.orders.length, 'pedido', 'pedidos')} · <span className="gx-num">{money(fromCents(group.totalCents))}</span>
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                        {open ? 'Ocultar pedidos' : 'Escolher pedidos'}
                    </Button>
                    <Button variant="primary" loading={busy === key} disabled={!chosen.length || (busy != null && busy !== key)} onClick={() => void bill()}>
                        {chosen.length === group.orders.length ? 'Faturar tudo' : `Faturar ${chosen.length}`} · {money(fromCents(totalCents))}
                    </Button>
                </div>
            </div>
            {open ? (
                <ul className="mt-3 flex flex-col">
                    {group.orders.map((order: BillableOrder) => (
                        <li key={order.id} className="gx-hair-t">
                            <label className="flex min-h-10 cursor-pointer items-center gap-3 py-1.5">
                                <input type="checkbox" checked={!excluded.has(order.id)} onChange={() => toggle(order.id)} />
                                <span className="gx-mono flex-1 text-[13px]">{orderLabel(order)}</span>
                                <span className="gx-num">{money(order.amount)}</span>
                            </label>
                        </li>
                    ))}
                </ul>
            ) : null}
        </li>
    );
};

const BlockedRow: React.FC<{ order: BlockedOrder; dueDate: string; busy: string | null; run: ReturnType<typeof useAction>['run'] }> = ({ order, dueDate, busy, run }) => {
    const key = `prepare:${order.id}`;
    /** Como a clássica: cria a conta do pagador e já fatura o pedido (dois passos num clique). */
    const prepareAndBill = async () => {
        await run(
            key,
            async () => {
                const prepared = (await invoicesApi.preparePayer(order.id)).data;
                await invoicesApi.create({ orderId: prepared.id, accountId: prepared.accountId, ...(dueDate ? { dueDate: dueDateIso(dueDate) } : {}) });
            },
            { success: 'Conta criada e pedido faturado.', error: 'Não foi possível criar a conta e faturar.' },
        );
        // A conta pode ter sido criada mesmo que a fatura falhe: o pedido passa a aparecer faturável.
        invalidate('invoices:', KEYS.unbilled);
    };

    return (
        <li className="gx-hair-b flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 last:border-b-0">
            <div className="min-w-0">
                <p className="text-[14px]">
                    <span className="gx-mono">{orderLabel(order)}</span> · <span className="gx-num">{money(order.amount)}</span>
                </p>
                <p className="gx-muted text-[13px]">
                    {BLOCK_REASON[order.reason]}
                    {order.payerName ? ` — ${order.payerName}` : ''}
                </p>
            </div>
            {order.reason === 'PAYER_WITHOUT_ACCOUNT' ? (
                <Button variant="soft" size="sm" loading={busy === key} disabled={busy != null && busy !== key} onClick={() => void prepareAndBill()}>
                    Criar conta e faturar
                </Button>
            ) : (
                <Link to={`/orders/${order.id}`} className="gx-btn gx-btn-ghost gx-btn-sm">
                    Definir o pagador no pedido
                </Link>
            )}
        </li>
    );
};

export const FaturarTab: React.FC = () => {
    const [pages, setPages] = useState(1);
    const [dueDate, setDueDate] = useState('');
    const loaded = useEligibleOrders(pages);
    // "Carregar mais" muda a chave de leitura: segura a lista anterior na tela até a nova chegar.
    const last = useRef(loaded.data);
    if (loaded.data) last.current = loaded.data;
    const eligible = { ...loaded, data: loaded.data ?? last.current };
    const { busy, run } = useAction();
    const split = useMemo(() => (eligible.data ? splitEligible(eligible.data.items) : null), [eligible.data]);
    const groups = useMemo(() => (split ? groupByPayer(split.billable) : []), [split]);
    const hasMore = eligible.data ? eligible.data.items.length < eligible.data.total : false;

    return (
        <div className="flex flex-col gap-6">
            <Panel
                title="Frete pronto para faturar"
                hint="Pedidos com frete confirmado e ainda sem fatura, do mais antigo ao mais novo."
                mode="manual"
                actions={
                    <div className="w-[190px]">
                        <Field label="Vencimento (opcional)">
                            <TextInput type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                        </Field>
                    </div>
                }
            >
                <div className="gx-inset mb-4 flex flex-wrap items-center gap-3 px-4 py-3">
                    <ModeBadge mode="copilot" />
                    <p className="gx-soft text-[13.5px]">Agrupado por quem paga o frete: um toque fatura o grupo inteiro numa fatura só.</p>
                </div>
                <Loadable
                    state={eligible}
                    isEmpty={(data) => data.items.length === 0}
                    empty={<EmptyState title="Nada a faturar." hint="Todo frete confirmado já tem fatura." />}
                >
                    {() => (
                        <div className="flex flex-col gap-4">
                            {groups.length ? (
                                <ul className="flex flex-col gap-3">
                                    {groups.map((group) => (
                                        <GroupCard key={group.accountId} group={group} dueDate={dueDate} busy={busy} run={run} />
                                    ))}
                                </ul>
                            ) : (
                                <p className="gx-muted text-[14px]">Nenhum pedido pronto: veja os que dependem do pagador logo abaixo.</p>
                            )}
                            {hasMore && eligible.data ? (
                                <div className="flex flex-wrap items-center gap-3">
                                    <p className="gx-muted text-[13px]">Mostrando {eligible.data.items.length} de {eligible.data.total}.</p>
                                    <Button size="sm" variant="soft" loading={eligible.loading || eligible.refreshing} onClick={() => setPages((value) => value + 1)}>
                                        Carregar mais
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    )}
                </Loadable>
            </Panel>

            {split?.blocked.length ? (
                <Panel title="Ainda não dá para faturar" count={split.blocked.length} countTone="yellow" hint="Falta definir quem paga. Resolva o pagador e o pedido entra no grupo dele.">
                    <ul className="flex flex-col">
                        {split.blocked.map((order) => (
                            <BlockedRow key={order.id} order={order} dueDate={dueDate} busy={busy} run={run} />
                        ))}
                    </ul>
                </Panel>
            ) : null}
        </div>
    );
};
