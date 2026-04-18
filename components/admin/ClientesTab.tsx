import React, { useState, useEffect } from 'react';
import { clientsApi } from '../../lib/api';
import type { Client } from '../../types/index';

const ClientesTab: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await clientsApi.list();
      const data = (res as any)?.data ?? res;
      setClients(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar clientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-bold text-tower-700">Clientes</h2>
        <button type="button" onClick={load} className="px-4 py-2 text-sm text-tower-600 hover:bg-tower-100 rounded-lg">Atualizar</button>
      </div>
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}
      {loading ? (
        <div className="py-12 text-center text-tower-500">Carregando...</div>
      ) : clients.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-tower-200 rounded-xl p-12 text-center text-tower-500">Nenhum cliente cadastrado.</div>
      ) : (
        <div className="bg-white border border-tower-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-tower-50 border-b border-tower-200">
              <tr>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Razão social</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Documento</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">Contato</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-tower-700">E-mail</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.id} className="border-b border-tower-100 hover:bg-tower-50">
                  <td className="py-3 px-4 font-medium text-tower-900">{c.companyName}</td>
                  <td className="py-3 px-4 text-tower-600">{c.document}</td>
                  <td className="py-3 px-4 text-tower-600">{c.contactName} {c.phone ? `· ${c.phone}` : ''}</td>
                  <td className="py-3 px-4 text-tower-600">{c.user?.email ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ClientesTab;
