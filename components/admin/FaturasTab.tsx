import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRegisterGestaoModuleActions } from './layout/GestaoModuleActionsContext';
import { invoicesApi, uploadApi } from '../../lib/api';
import PayablesPanel from './PayablesPanel';

const statusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  PAID: 'Paga',
  OVERDUE: 'Vencida',
  CANCELLED: 'Cancelada',
};

const FaturasTab: React.FC = () => {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<Awaited<ReturnType<typeof invoicesApi.receipts>>['data'] | null>(null);
  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptReference, setReceiptReference] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [savingReceipt, setSavingReceipt] = useState(false);
  const receiptKey = useRef<string | null>(null);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [eligibleOrders, setEligibleOrders] = useState<Array<{ id: string; nfNumber?: string | null; clientName?: string; accountId: string; amount: number }>>([]);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [gestaoFilterOpen, setGestaoFilterOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoicesApi.list({
        limit: 100,
        ...(statusFilter ? { status: statusFilter } : {}),
      });
      const data = (res as any)?.data ?? res;
      setInvoices(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar faturas');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = useCallback(() => {
    setShowCreate(true);
    setSelectedOrderIds([]);
    setError(null);
    void invoicesApi.eligibleOrders().then((res) => setEligibleOrders(res.data)).catch((e) => setError(e.response?.data?.error || e.message || 'Erro ao carregar pedidos faturáveis'));
  }, []);

  const createInvoice = async (event: React.FormEvent) => {
    event.preventDefault();
    const selected = eligibleOrders.filter((order) => selectedOrderIds.includes(order.id));
    if (!selected.length || saving) return;
    setSaving(true);
    setError(null);
    try {
      const isoDate = dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : undefined;
      if (selected.length === 1) await invoicesApi.create({ orderId: selected[0].id, accountId: selected[0].accountId, ...(isoDate ? { dueDate: isoDate } : {}) });
      else await invoicesApi.createGroup(selected[0].accountId, selected.map((order) => order.id), isoDate);
      setShowCreate(false);
      setSelectedOrderIds([]);
      setDueDate('');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao criar fatura');
    } finally { setSaving(false); }
  };

  const openReceipts = async (id: string) => {
    setSelectedInvoice(id);
    setReceiptData(null);
    setError(null);
    try { setReceiptData((await invoicesApi.receipts(id)).data); }
    catch (e: any) { setError(e.response?.data?.error || e.message || 'Erro ao carregar recebimentos'); }
  };

  const submitReceipt = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedInvoice || savingReceipt) return;
    setSavingReceipt(true);
    setError(null);
    try {
      let evidenceStorageKey: string | undefined;
      if (receiptFile) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
          reader.onerror = () => reject(new Error('Não foi possível ler o comprovante.'));
          reader.readAsDataURL(receiptFile);
        });
        evidenceStorageKey = (await uploadApi.upload(base64, receiptFile.name, receiptFile.type || 'application/pdf')).data.storageKey;
      }
      receiptKey.current ??= crypto.randomUUID();
      await invoicesApi.addReceipt(selectedInvoice, { amount: Number(receiptAmount), reference: receiptReference.trim() || undefined, evidenceStorageKey, idempotencyKey: receiptKey.current });
      receiptKey.current = null;
      setReceiptAmount('');
      setReceiptReference('');
      setReceiptFile(null);
      await Promise.all([openReceipts(selectedInvoice), load()]);
    } catch (e: any) { setError(e.response?.data?.error || e.message || 'Erro ao registrar recebimento'); }
    finally { setSavingReceipt(false); }
  };

  const fatGestao = useMemo(
    () => ({
      listActive: !gestaoFilterOpen,
      filterOpen: gestaoFilterOpen,
      filterCount: statusFilter ? 1 : 0,
      pills: statusFilter
        ? [
            {
              id: 'st',
              label: `Status: ${statusLabels[statusFilter] ?? statusFilter}`,
              onRemove: () => setStatusFilter(''),
            },
          ]
        : [],
      onList: () => {
        setGestaoFilterOpen(false);
        void load();
        document.getElementById('faturas-tabela')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      onFilterToggle: () => setGestaoFilterOpen((v) => !v),
      onNew: openNew,
      disabled: { edit: true } as const,
      labels: {
        edit: 'Edição de fatura: use ações na linha (ex.: marcar paga).',
      },
    }),
    [gestaoFilterOpen, statusFilter, load, openNew]
  );

  useRegisterGestaoModuleActions(() => fatGestao, [fatGestao]);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-tower-700 dark:text-tower-200">Notas / Faturamento</h2>
      </div>
      {showCreate && (
        <form onSubmit={createInvoice} className="mb-5 rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800">
          <h3 className="mb-3 text-sm font-bold">Nova fatura de pedido</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <fieldset className="text-sm"><legend className="font-semibold">Pedidos com frete confirmado</legend>
              <p className="mt-1 text-xs text-tower-500">Selecione vários pedidos do mesmo pagador para uma única fatura.</p>
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-tower-300 p-2">
                {eligibleOrders.map((order) => {
                  const selectedAccount = eligibleOrders.find((item) => selectedOrderIds.includes(item.id))?.accountId;
                  return <label key={order.id} className="flex items-center gap-2 py-1">
                    <input type="checkbox" checked={selectedOrderIds.includes(order.id)} disabled={!!selectedAccount && selectedAccount !== order.accountId} onChange={(event) => setSelectedOrderIds((current) => event.target.checked ? [...current, order.id] : current.filter((id) => id !== order.id))} />
                    <span>{order.nfNumber || order.id.slice(0, 8)} · {order.clientName || 'Cliente'} · R$ {order.amount.toFixed(2)}</span>
                  </label>;
                })}
                {!eligibleOrders.length && <p className="text-tower-500">Nenhum pedido faturável encontrado.</p>}
              </div>
              {!!selectedOrderIds.length && <p className="mt-1 font-semibold">Total: R$ {eligibleOrders.filter((order) => selectedOrderIds.includes(order.id)).reduce((sum, order) => sum + order.amount, 0).toFixed(2)}</p>}
            </fieldset>
            <label className="text-sm">Vencimento
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 p-2 dark:bg-tower-800" />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={!selectedOrderIds.length || saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Criando…' : 'Criar fatura'}</button>
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-tower-300 px-4 py-2 text-sm">Cancelar</button>
          </div>
        </form>
      )}
      {gestaoFilterOpen && (
        <div className="mb-4 rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800">
          <label className="mb-1 block text-xs font-semibold text-tower-600 dark:text-tower-400" htmlFor="fat-st">
            Status
          </label>
          <select
            id="fat-st"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100"
          >
            <option value="">Todos os status</option>
            {Object.entries(statusLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}
      {loading ? (
        <div className="py-12 text-center text-tower-500">Carregando...</div>
      ) : invoices.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-tower-200 rounded-xl p-12 text-center text-tower-500">
          Nenhuma fatura encontrada.
        </div>
      ) : (
        <div id="faturas-tabela" className="bg-white border border-tower-200 rounded-xl overflow-hidden dark:border-tower-600 dark:bg-tower-800">
          <table className="w-full">
            <thead className="bg-tower-50 border-b border-tower-200">
              <tr>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">ID / Referência</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Conta</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-tower-700">Subtotal</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Status</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Vencimento</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-tower-700">Ações</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-tower-100 hover:bg-tower-50">
                  <td className="py-3 px-4 font-medium text-tower-900">{inv.invoiceNumber ?? inv.id?.slice(0, 8) ?? '-'}{inv.items?.length > 1 && <span className="ml-2 text-xs font-normal text-tower-500">{inv.items.length} pedidos</span>}</td>
                  <td className="py-3 px-4 text-tower-600">{inv.account?.name ?? inv.accountId?.slice(0, 8) ?? '-'}</td>
                  <td className="py-3 px-4 text-right text-tower-700">R$ {Number(inv.subtotal ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-tower-100 text-tower-700">
                      {statusLabels[inv.status] ?? inv.status ?? '-'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-tower-600">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('pt-BR') : '-'}</td>
                  <td className="py-3 px-4 text-right">
                    {inv.status !== 'CANCELLED' && (
                      <button
                        type="button"
                        onClick={() => { void openReceipts(inv.id); }}
                        className="px-3 py-1 text-xs bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
                      >
                        {inv.status === 'PAID' ? 'Ver baixas' : 'Registrar baixa'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selectedInvoice && (
        <section className="mt-5 rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800" aria-label="Recebimentos da fatura">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold">Recebimentos · {invoices.find((inv) => inv.id === selectedInvoice)?.invoiceNumber ?? selectedInvoice.slice(0, 8)}</h3>
            <button type="button" onClick={() => setSelectedInvoice(null)} className="text-sm underline">Fechar</button>
          </div>
          {receiptData ? <p className="mt-2 text-sm">Recebido: R$ {receiptData.received.toFixed(2)} · Saldo: R$ {receiptData.balance.toFixed(2)}</p> : <p className="mt-2 text-sm">Carregando saldo…</p>}
          {receiptData && receiptData.balance > 0 && (
            <form onSubmit={submitReceipt} className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-sm">Valor recebido
                <input required type="number" min="0.01" max={receiptData.balance} step="0.01" value={receiptAmount} onChange={(e) => setReceiptAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 p-2 dark:bg-tower-800" />
              </label>
              <label className="text-sm">Referência do pagamento
                <input value={receiptReference} onChange={(e) => setReceiptReference(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 p-2 dark:bg-tower-800" />
              </label>
              <label className="text-sm">Comprovante (opcional)
                <input type="file" accept="application/pdf,image/*" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} className="mt-1 w-full text-sm" />
              </label>
              <button type="submit" disabled={savingReceipt} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 sm:col-span-3">{savingReceipt ? 'Registrando…' : 'Confirmar recebimento'}</button>
            </form>
          )}
          <ul className="mt-4 space-y-2">
            {receiptData?.receipts.map((receipt) => <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-tower-200 py-2 text-sm">
              <span>R$ {Number(receipt.amount).toFixed(2)} · {new Date(receipt.receivedAt).toLocaleDateString('pt-BR')} {receipt.reference ? `· ${receipt.reference}` : ''} {receipt.reversedAt ? `· Estornado: ${receipt.reversalReason ?? ''}` : ''}</span>
              {!receipt.reversedAt && <button type="button" onClick={() => { setReversingId(receipt.id); setReversalReason(''); }} className="text-red-700 underline">Estornar</button>}
              {reversingId === receipt.id && <form onSubmit={async (event) => {
                event.preventDefault();
                try { await invoicesApi.reverseReceipt(selectedInvoice, receipt.id, reversalReason.trim()); setReversingId(null); await Promise.all([openReceipts(selectedInvoice), load()]); }
                catch (e: any) { setError(e.response?.data?.error || e.message || 'Erro ao estornar recebimento'); }
              }} className="flex w-full flex-wrap items-end gap-2">
                <label className="min-w-60 flex-1">Motivo do estorno
                  <input required minLength={5} value={reversalReason} onChange={(e) => setReversalReason(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 p-2 dark:bg-tower-800" />
                </label>
                <button type="submit" className="rounded-lg border border-red-600 px-3 py-2 text-red-700">Confirmar estorno</button>
                <button type="button" onClick={() => setReversingId(null)} className="rounded-lg border border-tower-300 px-3 py-2">Cancelar</button>
              </form>}
            </li>)}
          </ul>
        </section>
      )}
      <PayablesPanel />
    </div>
  );
};

export default FaturasTab;
