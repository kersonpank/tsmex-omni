import React, { useState, useEffect } from 'react';
import { invoicesApi } from '../../lib/api';

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
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);

  const load = async () => {
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
  };

  useEffect(() => { load(); }, [statusFilter]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h2 className="text-lg font-bold text-tower-700">Notas / Faturamento</h2>
        <div className="flex gap-2 items-center">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors"
          >
            <option value="">Todos os status</option>
            {Object.entries(statusLabels).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button type="button" onClick={load} className="px-4 py-2 text-sm text-tower-600 hover:bg-tower-100 rounded-lg">
            Atualizar
          </button>
        </div>
      </div>
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
        <div className="bg-white border border-tower-200 rounded-xl overflow-hidden">
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
                  <td className="py-3 px-4 font-medium text-tower-900">{inv.id?.slice(0, 8) ?? '-'}</td>
                  <td className="py-3 px-4 text-tower-600">{inv.accountId?.slice(0, 8) ?? '-'}</td>
                  <td className="py-3 px-4 text-right text-tower-700">R$ {(inv.subtotal ?? 0).toLocaleString()}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-tower-100 text-tower-700">
                      {statusLabels[inv.status] ?? inv.status ?? '-'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-tower-600">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('pt-BR') : '-'}</td>
                  <td className="py-3 px-4 text-right">
                    {inv.status === 'PENDING' && (
                      <button
                        type="button"
                        disabled={!!markingPaid}
                        onClick={async () => {
                          setMarkingPaid(inv.id);
                          try {
                            await invoicesApi.updateStatus(inv.id, { status: 'PAID', paidAt: new Date().toISOString() });
                            await load();
                          } catch (e: any) {
                            setError(e.response?.data?.error || e.message || 'Erro ao marcar como paga');
                          } finally {
                            setMarkingPaid(null);
                          }
                        }}
                        className="px-3 py-1 text-xs bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
                      >
                        {markingPaid === inv.id ? '...' : 'Marcar como paga'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default FaturasTab;
