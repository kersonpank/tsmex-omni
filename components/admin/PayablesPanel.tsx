import React, { useEffect, useRef, useState } from 'react';
import { payablesApi, uploadApi, type PayableRow } from '../../lib/api';

const dueDateIso = (date: string) => new Date(`${date}T12:00:00`).toISOString();

const PayablesPanel: React.FC = () => {
  const [rows, setRows] = useState<PayableRow[]>([]);
  const [candidates, setCandidates] = useState<Awaited<ReturnType<typeof payablesApi.settlementCandidates>>['data']>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'manual' | 'manifest' | null>(null);
  const [beneficiaryType, setBeneficiaryType] = useState<PayableRow['beneficiaryType']>('PARTNER');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [manifestId, setManifestId] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof payablesApi.payments>>['data'] | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const paymentKey = useRef<string | null>(null);

  const load = async () => {
    try { setRows((await payablesApi.list()).data); }
    catch (cause: any) { setError(cause.response?.data?.error || cause.message || 'Erro ao carregar contas a pagar'); }
  };
  useEffect(() => { void load(); }, []);

  const openMode = async (next: 'manual' | 'manifest') => {
    setError(null);
    setMode(next);
    if (next === 'manifest') {
      try { setCandidates((await payablesApi.settlementCandidates()).data); }
      catch (cause: any) { setError(cause.response?.data?.error || cause.message || 'Erro ao carregar viagens'); }
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dueDate || saving) return;
    setSaving(true); setError(null);
    try {
      if (mode === 'manifest') await payablesApi.fromManifest(manifestId, dueDateIso(dueDate));
      else await payablesApi.create({ beneficiaryType, beneficiaryName, description, amount: Number(amount), dueDate: dueDateIso(dueDate) });
      setMode(null); setBeneficiaryName(''); setDescription(''); setAmount(''); setDueDate(''); setManifestId('');
      await load();
    } catch (cause: any) { setError(cause.response?.data?.error || cause.message || 'Erro ao criar conta a pagar'); }
    finally { setSaving(false); }
  };

  const openPayments = async (id: string) => {
    setSelectedId(id); setDetail(null); setError(null);
    try { setDetail((await payablesApi.payments(id)).data); }
    catch (cause: any) { setError(cause.response?.data?.error || cause.message || 'Erro ao carregar pagamentos'); }
  };

  const pay = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedId || saving) return;
    setSaving(true); setError(null);
    try {
      let evidenceStorageKey: string | undefined;
      if (file) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
          reader.onerror = () => reject(new Error('Falha ao ler o comprovante.'));
          reader.readAsDataURL(file);
        });
        evidenceStorageKey = (await uploadApi.upload(base64, file.name, file.type || 'application/pdf')).data.storageKey;
      }
      paymentKey.current ??= crypto.randomUUID();
      await payablesApi.addPayment(selectedId, { amount: Number(paymentAmount), reference: reference.trim() || undefined, evidenceStorageKey, idempotencyKey: paymentKey.current });
      paymentKey.current = null; setPaymentAmount(''); setReference(''); setFile(null);
      await Promise.all([openPayments(selectedId), load()]);
    } catch (cause: any) { setError(cause.response?.data?.error || cause.message || 'Erro ao registrar pagamento'); }
    finally { setSaving(false); }
  };

  return <section className="mt-8 rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-700 dark:bg-tower-800">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-bold">Contas a pagar</h2><p className="text-sm text-tower-500">Acertos de viagem e despesas com origem registrada.</p></div>
      <div className="flex gap-2">
        <button type="button" onClick={() => { void openMode('manifest'); }} className="rounded-lg border border-brand-500 px-3 py-2 text-sm text-brand-700">Acerto de viagem</button>
        <button type="button" onClick={() => { void openMode('manual'); }} className="rounded-lg bg-brand-600 px-3 py-2 text-sm text-white">Nova despesa</button>
      </div>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {mode && <form onSubmit={create} className="mt-4 grid gap-3 rounded-lg border border-tower-200 p-3 sm:grid-cols-2">
      {mode === 'manifest' ? <label className="text-sm sm:col-span-2">Viagem concluída com Carta Frete
        <select required value={manifestId} onChange={(e) => setManifestId(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 p-2 dark:bg-tower-800">
          <option value="">Selecione uma viagem</option>
          {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.origin} → {candidate.destination} · {candidate.link?.name} · R$ {candidate.freightAgreement?.saldoLiquido.toFixed(2)}</option>)}
        </select>
      </label> : <>
        <label className="text-sm">Beneficiário
          <input required minLength={2} value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 p-2 dark:bg-tower-800" />
        </label>
        <label className="text-sm">Tipo
          <select value={beneficiaryType} onChange={(e) => setBeneficiaryType(e.target.value as PayableRow['beneficiaryType'])} className="mt-1 w-full rounded-lg border border-tower-300 p-2 dark:bg-tower-800">
            <option value="PARTNER">Parceiro</option><option value="HUB">Hub</option><option value="LINK">Motorista / Link</option><option value="OTHER">Outro</option>
          </select>
        </label>
        <label className="text-sm">Descrição
          <input required minLength={3} value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 p-2 dark:bg-tower-800" />
        </label>
        <label className="text-sm">Valor (R$)
          <input required type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 p-2 dark:bg-tower-800" />
        </label>
      </>}
      <label className="text-sm">Vencimento
        <input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 p-2 dark:bg-tower-800" />
      </label>
      <div className="flex items-end gap-2"><button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? 'Salvando…' : 'Criar título'}</button><button type="button" onClick={() => setMode(null)} className="rounded-lg border border-tower-300 px-4 py-2 text-sm">Cancelar</button></div>
    </form>}
    <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-tower-200"><th className="py-2">Beneficiário</th><th>Origem</th><th>Vencimento</th><th className="text-right">Saldo</th><th className="text-right">Ação</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id} className="border-b border-tower-100"><td className="py-2 font-semibold">{row.beneficiaryName}</td><td>{row.description}</td><td>{new Date(row.dueDate).toLocaleDateString('pt-BR')}</td><td className="text-right">R$ {row.balance.toFixed(2)}</td><td className="text-right"><button type="button" onClick={() => { void openPayments(row.id); }} className="text-brand-700 underline">{row.balance ? 'Baixar' : 'Ver pagamentos'}</button></td></tr>)}
    </tbody></table>{!rows.length && <p className="py-6 text-center text-sm text-tower-500">Nenhum título registrado.</p>}</div>
    {selectedId && <div className="mt-4 rounded-lg border border-tower-200 p-3">
      <div className="flex justify-between"><h3 className="font-bold">Pagamentos · {detail?.payable.beneficiaryName ?? 'Carregando…'}</h3><button type="button" onClick={() => setSelectedId(null)} className="text-sm underline">Fechar</button></div>
      {detail && <p className="mt-1 text-sm">Pago: R$ {detail.paid.toFixed(2)} · Saldo: R$ {detail.balance.toFixed(2)}</p>}
      {detail && detail.balance > 0 && <form onSubmit={pay} className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">Valor pago<input required type="number" min="0.01" max={detail.balance} step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 p-2 dark:bg-tower-800" /></label>
        <label className="text-sm">Referência<input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 p-2 dark:bg-tower-800" /></label>
        <label className="text-sm">Comprovante<input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 w-full text-sm" /></label>
        <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50 sm:col-span-3">{saving ? 'Registrando…' : 'Confirmar pagamento'}</button>
      </form>}
      <ul className="mt-3 space-y-2">{detail?.payable.payments.map((payment) => <li key={payment.id} className="flex flex-wrap justify-between gap-2 border-t border-tower-200 py-2 text-sm">
        <span>R$ {Number(payment.amount).toFixed(2)} · {new Date(payment.paidAt).toLocaleDateString('pt-BR')} {payment.reversedAt ? `· Estornado: ${payment.reversalReason ?? ''}` : ''}</span>
        {!payment.reversedAt && <button type="button" onClick={() => { setReversingId(payment.id); setReversalReason(''); }} className="text-red-700 underline">Estornar</button>}
        {reversingId === payment.id && <form onSubmit={async (event) => { event.preventDefault(); try { await payablesApi.reversePayment(selectedId, payment.id, reversalReason); setReversingId(null); await Promise.all([openPayments(selectedId), load()]); } catch (cause: any) { setError(cause.response?.data?.error || cause.message || 'Erro ao estornar'); } }} className="flex w-full gap-2">
          <label className="flex-1 text-sm">Motivo<input required minLength={5} value={reversalReason} onChange={(e) => setReversalReason(e.target.value)} className="mt-1 w-full rounded-lg border border-tower-300 p-2 dark:bg-tower-800" /></label>
          <button type="submit" className="rounded-lg border border-red-500 px-3 py-2 text-red-700">Confirmar</button>
        </form>}
      </li>)}</ul>
    </div>}
  </section>;
};

export default PayablesPanel;
