import React, { useCallback, useEffect, useState } from 'react';
import {
  costAgreementsApi,
  hubsApi,
  linksApi,
  vehicleTypesApi,
  type HubCommissionAgreementRow,
  type LinkCostAgreementRow,
} from '../../lib/api';

const MODE_LABELS: Record<LinkCostAgreementRow['costMode'], string> = {
  FLAT: 'Valor fechado',
  PER_M3: 'Por m³',
  PER_KG: 'Por kg',
};

const money = (value: number) => `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const errorText = (cause: any, fallback: string) => cause?.response?.data?.error || cause?.message || fallback;

/**
 * Acordos de custo que alimentam a margem da viagem: o que pagamos ao transportador por rota e
 * veículo, e a comissão do hub parceiro. Sem acordo, a margem fica "incompleta" (transportador)
 * ou a comissão do hub conta zero.
 */
const CostAgreementsPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkRows, setLinkRows] = useState<LinkCostAgreementRow[]>([]);
  const [hubRows, setHubRows] = useState<HubCommissionAgreementRow[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [links, setLinks] = useState<Array<{ id: string; name: string }>>([]);
  const [hubs, setHubs] = useState<Array<{ id: string; name: string }>>([]);
  const [vehicleTypes, setVehicleTypes] = useState<Array<{ code: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);

  const [linkForm, setLinkForm] = useState({ linkId: '', originCity: '', destinationCity: '', vehicleTypeCode: '', costMode: 'FLAT' as LinkCostAgreementRow['costMode'], flatRate: '', ratePerM3: '', ratePerKg: '' });
  const [hubForm, setHubForm] = useState({ hubId: '', handlingFeePerOrder: '', percentOfFreight: '' });

  const load = useCallback(async () => {
    setError(null);
    try {
      const active = showClosed ? undefined : true;
      const [l, h] = await Promise.all([costAgreementsApi.listLink({ active }), costAgreementsApi.listHub({ active })]);
      setLinkRows(l.data);
      setHubRows(h.data);
    } catch (cause) {
      setError(errorText(cause, 'Erro ao carregar acordos de custo'));
    }
  }, [showClosed]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open || links.length) return;
    void Promise.all([linksApi.list(), hubsApi.list(), vehicleTypesApi.list()])
      .then(([l, h, v]) => {
        setLinks((l.data ?? []).map((x: any) => ({ id: x.id, name: x.name })));
        setHubs((h.data ?? []).map((x: any) => ({ id: x.id, name: x.name })));
        setVehicleTypes((v.data ?? []).map((x: any) => ({ code: x.code, name: x.name })));
      })
      .catch((cause) => setError(errorText(cause, 'Erro ao carregar cadastros')));
  }, [open, links.length]);

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setError(errorText(cause, fallback));
    } finally {
      setSaving(false);
    }
  };

  const submitLink = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await costAgreementsApi.createLink({
        linkId: linkForm.linkId,
        originCity: linkForm.originCity,
        destinationCity: linkForm.destinationCity,
        vehicleTypeCode: linkForm.vehicleTypeCode,
        costMode: linkForm.costMode,
        flatRate: Number(linkForm.flatRate || 0),
        ratePerM3: linkForm.costMode === 'PER_M3' ? Number(linkForm.ratePerM3) : null,
        ratePerKg: linkForm.costMode === 'PER_KG' ? Number(linkForm.ratePerKg) : null,
      });
      setLinkForm({ ...linkForm, originCity: '', destinationCity: '', flatRate: '', ratePerM3: '', ratePerKg: '' });
    }, 'Erro ao criar acordo do transportador');
  };

  const submitHub = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await costAgreementsApi.createHub({
        hubId: hubForm.hubId,
        handlingFeePerOrder: Number(hubForm.handlingFeePerOrder || 0),
        percentOfFreight: hubForm.percentOfFreight ? Number(hubForm.percentOfFreight) : null,
      });
      setHubForm({ hubId: '', handlingFeePerOrder: '', percentOfFreight: '' });
    }, 'Erro ao criar comissão do hub');
  };

  const inputClass = 'mt-1 w-full rounded-lg border border-tower-300 p-2 text-sm dark:bg-tower-800';

  return (
    <section className="mt-8 rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800" aria-label="Acordos de custo">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold">Acordos de custo (margem)</h3>
          <p className="text-xs text-tower-500">Quanto pagamos ao transportador por rota e a comissão do hub parceiro. Sem eles a margem da viagem fica incompleta.</p>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-lg border border-tower-300 px-3 py-1 text-xs font-semibold">{open ? 'Recolher' : 'Abrir'}</button>
      </div>

      {open && (
        <div className="mt-4 space-y-6">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Mostrar encerrados</label>

          <div>
            <h4 className="mb-2 text-sm font-semibold">Transportador por rota e veículo</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-tower-200 text-left text-xs text-tower-500"><th className="py-2 pr-3">Transportador</th><th className="pr-3">Rota</th><th className="pr-3">Veículo</th><th className="pr-3">Modo</th><th className="pr-3 text-right">Valor</th><th /></tr></thead>
                <tbody>
                  {linkRows.map((row) => (
                    <tr key={row.id} className={`border-b border-tower-100 ${row.active ? '' : 'opacity-50'}`}>
                      <td className="py-2 pr-3">{row.link?.name ?? row.linkId.slice(0, 8)}</td>
                      <td className="pr-3">{row.originCity} → {row.destinationCity}</td>
                      <td className="pr-3">{row.vehicleTypeCode}</td>
                      <td className="pr-3">{MODE_LABELS[row.costMode]}</td>
                      <td className="pr-3 text-right">{row.costMode === 'PER_M3' ? `${money(row.ratePerM3 ?? 0)}/m³` : row.costMode === 'PER_KG' ? `${money(row.ratePerKg ?? 0)}/kg` : money(row.flatRate)}</td>
                      <td className="text-right">{row.active ? <button type="button" disabled={saving} onClick={() => { void run(() => costAgreementsApi.closeLink(row.id), 'Erro ao encerrar acordo'); }} className="text-xs text-red-700 underline disabled:opacity-50">Encerrar</button> : <span className="text-xs">Encerrado</span>}</td>
                    </tr>
                  ))}
                  {!linkRows.length && <tr><td colSpan={6} className="py-3 text-tower-500">Nenhum acordo de transportador.</td></tr>}
                </tbody>
              </table>
            </div>
            <form onSubmit={submitLink} className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-sm">Transportador
                <select required value={linkForm.linkId} onChange={(e) => setLinkForm({ ...linkForm, linkId: e.target.value })} className={inputClass}>
                  <option value="">Selecione…</option>
                  {links.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <label className="text-sm">Origem
                <input required value={linkForm.originCity} onChange={(e) => setLinkForm({ ...linkForm, originCity: e.target.value })} className={inputClass} placeholder="São Paulo" />
              </label>
              <label className="text-sm">Destino
                <input required value={linkForm.destinationCity} onChange={(e) => setLinkForm({ ...linkForm, destinationCity: e.target.value })} className={inputClass} placeholder="Imperatriz" />
              </label>
              <label className="text-sm">Tipo de veículo
                <select required value={linkForm.vehicleTypeCode} onChange={(e) => setLinkForm({ ...linkForm, vehicleTypeCode: e.target.value })} className={inputClass}>
                  <option value="">Selecione…</option>
                  {vehicleTypes.map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}
                </select>
              </label>
              <label className="text-sm">Como cobra
                <select value={linkForm.costMode} onChange={(e) => setLinkForm({ ...linkForm, costMode: e.target.value as LinkCostAgreementRow['costMode'] })} className={inputClass}>
                  {Object.entries(MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              {linkForm.costMode === 'FLAT' && (
                <label className="text-sm">Valor da viagem (R$)
                  <input required type="number" min="0" step="0.01" value={linkForm.flatRate} onChange={(e) => setLinkForm({ ...linkForm, flatRate: e.target.value })} className={inputClass} />
                </label>
              )}
              {linkForm.costMode === 'PER_M3' && (
                <label className="text-sm">Valor por m³ (R$)
                  <input required type="number" min="0.0001" step="0.0001" value={linkForm.ratePerM3} onChange={(e) => setLinkForm({ ...linkForm, ratePerM3: e.target.value })} className={inputClass} />
                </label>
              )}
              {linkForm.costMode === 'PER_KG' && (
                <label className="text-sm">Valor por kg (R$)
                  <input required type="number" min="0.0001" step="0.0001" value={linkForm.ratePerKg} onChange={(e) => setLinkForm({ ...linkForm, ratePerKg: e.target.value })} className={inputClass} />
                </label>
              )}
              <div className="flex items-end sm:col-span-3">
                <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Salvando…' : 'Adicionar acordo'}</button>
              </div>
            </form>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold">Comissão do hub parceiro</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-tower-200 text-left text-xs text-tower-500"><th className="py-2 pr-3">Hub</th><th className="pr-3 text-right">Taxa por pedido</th><th className="pr-3 text-right">% do frete</th><th /></tr></thead>
                <tbody>
                  {hubRows.map((row) => (
                    <tr key={row.id} className={`border-b border-tower-100 ${row.active ? '' : 'opacity-50'}`}>
                      <td className="py-2 pr-3">{row.hub?.name ?? row.hubId.slice(0, 8)}</td>
                      <td className="pr-3 text-right">{money(row.handlingFeePerOrder)}</td>
                      <td className="pr-3 text-right">{row.percentOfFreight != null ? `${row.percentOfFreight}%` : '—'}</td>
                      <td className="text-right">{row.active ? <button type="button" disabled={saving} onClick={() => { void run(() => costAgreementsApi.closeHub(row.id), 'Erro ao encerrar comissão'); }} className="text-xs text-red-700 underline disabled:opacity-50">Encerrar</button> : <span className="text-xs">Encerrado</span>}</td>
                    </tr>
                  ))}
                  {!hubRows.length && <tr><td colSpan={4} className="py-3 text-tower-500">Nenhuma comissão de hub. A comissão conta zero na margem.</td></tr>}
                </tbody>
              </table>
            </div>
            <form onSubmit={submitHub} className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-sm">Hub
                <select required value={hubForm.hubId} onChange={(e) => setHubForm({ ...hubForm, hubId: e.target.value })} className={inputClass}>
                  <option value="">Selecione…</option>
                  {hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </label>
              <label className="text-sm">Taxa por pedido (R$)
                <input type="number" min="0" step="0.01" value={hubForm.handlingFeePerOrder} onChange={(e) => setHubForm({ ...hubForm, handlingFeePerOrder: e.target.value })} className={inputClass} />
              </label>
              <label className="text-sm">% do frete
                <input type="number" min="0" max="100" step="0.01" value={hubForm.percentOfFreight} onChange={(e) => setHubForm({ ...hubForm, percentOfFreight: e.target.value })} className={inputClass} />
              </label>
              <div className="flex items-end sm:col-span-3">
                <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Salvando…' : 'Adicionar comissão'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};

export default CostAgreementsPanel;
