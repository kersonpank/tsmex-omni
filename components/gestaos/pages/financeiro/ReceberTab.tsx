import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { invoicesApi } from '../../../../lib/api';
import { Drawer, useAction } from '../../ui/overlay';
import { EmptyState, Loadable, Panel, Pill } from '../../ui/kit';
import { dateFull, money, plural } from '../../lib/format';
import { INVOICE_STATE_LABEL, invoiceState, type InvoiceState } from '../../lib/financeiro';
import { invalidate, useResource } from '../../lib/resource';
import { Ledger } from './Ledger';
import { useReceivable, type InvoiceRow } from './useFinanceiro';

const STATE_TONE: Record<InvoiceState, 'neutral' | 'red' | 'royal'> = { PAID: 'neutral', CANCELLED: 'neutral', OVERDUE: 'red', OPEN: 'royal' };

const invoiceLabel = (invoice: InvoiceRow) => invoice.invoiceNumber ?? invoice.id.slice(0, 8).toUpperCase();

const InvoiceDrawer: React.FC<{ invoice: InvoiceRow | null; invoiceId: string; onClose: () => void }> = ({ invoice, invoiceId, onClose }) => {
    const { busy, run } = useAction();
    const receipts = useResource(`invoices:receipts:${invoiceId}`, async () => (await invoicesApi.receipts(invoiceId)).data, { staleMs: 5_000 });
    const state = invoice ? invoiceState(invoice) : null;

    const refresh = () => invalidate('invoices:');

    return (
        <Drawer
            open
            onClose={onClose}
            title={invoice ? `Fatura ${invoiceLabel(invoice)}` : 'Fatura'}
            subtitle={invoice ? `${invoice.account?.name ?? 'Conta não informada'} · vence ${dateFull(invoice.dueDate)}` : undefined}
            badge={state ? <Pill tone={STATE_TONE[state]}>{INVOICE_STATE_LABEL[state]}</Pill> : undefined}
        >
            <div className="flex flex-col gap-6">
                {invoice?.items?.length ? (
                    <div>
                        <h3 className="gx-h2 mb-2">Itens da fatura</h3>
                        <ul className="gx-inset flex flex-col px-4">
                            {invoice.items.map((item) => (
                                <li key={item.id} className="gx-hair-b flex items-baseline justify-between gap-4 py-2.5 last:border-b-0">
                                    <span className="min-w-0 text-[14px]">
                                        {item.order?.nfNumber ? <span className="gx-mono mr-2">NF {item.order.nfNumber}</span> : null}
                                        <span className="gx-soft">{item.description ?? 'Frete'}</span>
                                    </span>
                                    <span className="gx-num flex-none">{money(item.amount)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}

                {state === 'CANCELLED' ? <p className="gx-soft text-[14px]">Fatura cancelada: não recebe baixa.</p> : null}

                <Loadable state={receipts}>
                    {(data) =>
                        state === 'CANCELLED' ? (
                            <p className="gx-muted text-[14px]">Recebimentos registrados: {data.receipts.length}.</p>
                        ) : (
                            <Ledger
                                kind="receipt"
                                targetId={invoiceId}
                                total={invoice?.total ?? invoice?.subtotal ?? data.received + data.balance}
                                settled={data.received}
                                balance={data.balance}
                                busy={busy}
                                entries={data.receipts.map((receipt) => ({ id: receipt.id, amount: receipt.amount, date: receipt.receivedAt, reference: receipt.reference, reversedAt: receipt.reversedAt, reversalReason: receipt.reversalReason }))}
                                onAdd={(amount, reference, idempotencyKey) =>
                                    run('receipt:add', () => invoicesApi.addReceipt(invoiceId, { amount, reference, idempotencyKey }).then(refresh), { success: 'Recebimento registrado.', error: 'O recebimento não foi registrado.' })
                                }
                                onReverse={(receiptId, reason) =>
                                    run('receipt:reverse', () => invoicesApi.reverseReceipt(invoiceId, receiptId, reason).then(refresh), { success: 'Recebimento estornado.', error: 'O estorno não foi feito.' })
                                }
                            />
                        )
                    }
                </Loadable>
            </div>
        </Drawer>
    );
};

export const ReceberTab: React.FC = () => {
    const { invoices, balances } = useReceivable();
    const [params, setParams] = useSearchParams();
    const openId = params.get('fatura');

    const select = (id: string | null) =>
        setParams(
            (current) => {
                const next = new URLSearchParams(current);
                if (id) next.set('fatura', id);
                else next.delete('fatura');
                return next;
            },
            { replace: true },
        );

    return (
        <Panel title="Faturas" hint="Cada baixa e cada estorno é lançado por uma pessoa e fica registrado." mode="manual" count={invoices.data ? plural(invoices.data.length, 'fatura', 'faturas') : null} padded={false}>
            <Loadable
                state={invoices}
                isEmpty={(list) => list.length === 0}
                empty={<div className="px-5 pb-5"><EmptyState title="Nenhuma fatura ainda." hint="Quando você faturar pedidos na aba A faturar, as faturas aparecem aqui." /></div>}
            >
                {(list) => (
                    <div className="gx-scroll-x px-2">
                        <table className="gx-table">
                            <thead>
                                <tr>
                                    <th>Número</th>
                                    <th>Conta</th>
                                    <th className="text-right">Total</th>
                                    <th className="text-right">Saldo</th>
                                    <th>Vencimento</th>
                                    <th>Situação</th>
                                </tr>
                            </thead>
                            <tbody>
                                {list.map((invoice) => {
                                    const state = invoiceState(invoice);
                                    const balance = balances?.[invoice.id];
                                    return (
                                        <tr key={invoice.id} data-clickable="true" onClick={() => select(invoice.id)}>
                                            <td>
                                                <button type="button" className="gx-mono border-0 bg-transparent p-0 text-left font-semibold" onClick={(event) => { event.stopPropagation(); select(invoice.id); }}>
                                                    {invoiceLabel(invoice)}
                                                </button>
                                                {(invoice.items?.length ?? 0) > 1 ? <span className="gx-muted ml-2 text-[12.5px]">{invoice.items?.length} pedidos</span> : null}
                                            </td>
                                            <td>{invoice.account?.name ?? invoice.accountId.slice(0, 8)}</td>
                                            <td className="gx-num text-right">{money(invoice.total ?? invoice.subtotal)}</td>
                                            <td className="gx-num text-right">{state === 'PAID' || state === 'CANCELLED' ? '—' : balance != null ? money(balance) : '…'}</td>
                                            <td className={state === 'OVERDUE' ? 'gx-red-text' : ''}>{dateFull(invoice.dueDate)}</td>
                                            <td>
                                                <Pill tone={STATE_TONE[state]} dot={state === 'OVERDUE'}>
                                                    {INVOICE_STATE_LABEL[state]}
                                                </Pill>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Loadable>
            {openId ? <InvoiceDrawer key={openId} invoiceId={openId} invoice={invoices.data?.find((invoice) => invoice.id === openId) ?? null} onClose={() => select(null)} /> : null}
        </Panel>
    );
};
