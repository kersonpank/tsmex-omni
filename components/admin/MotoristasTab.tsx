import React, { useState, useEffect } from 'react';
import { linksApi, vehicleTypesApi } from '../../lib/api';
import type { Link, VehicleType } from '../../types/index';

const statusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  REJECTED: 'Recusado',
  SUSPENDED: 'Suspenso',
};

const MotoristasTab: React.FC = () => {
  const [links, setLinks] = useState<Link[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [approveVehicleTypeId, setApproveVehicleTypeId] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [linksRes, vtRes] = await Promise.all([linksApi.list(), vehicleTypesApi.list()]);
      const data = (linksRes as any)?.data ?? linksRes;
      setLinks(Array.isArray(data) ? data : []);
      const vtData = (vtRes as any)?.data ?? vtRes;
      setVehicleTypes(Array.isArray(vtData) ? vtData : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar motoristas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (id: string, link: Link) => {
    const vehicleTypeId = approveVehicleTypeId[id] ?? link.vehicleTypeId;
    if (!vehicleTypeId) {
      alert('Selecione o tipo de veículo antes de aprovar.');
      return;
    }
    setActionLoading(id);
    try {
      await linksApi.approve(id, { vehicleTypeId });
      setApproveVehicleTypeId((prev) => ({ ...prev, [id]: undefined }));
      load();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string) => {
    const reason = window.prompt('Motivo da recusa (opcional):') ?? '';
    setActionLoading(id);
    try {
      await linksApi.reject(id, reason);
      load();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-bold text-slate-700">Motoristas (Links)</h2>
        <button type="button" onClick={load} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Atualizar</button>
      </div>
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}
      {loading ? (
        <div className="py-12 text-center text-slate-500">Carregando...</div>
      ) : links.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-xl p-12 text-center text-slate-500">Nenhum motorista cadastrado.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Nome</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Documento</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Telefone</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Tipo veículo</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Status</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">Ações</th>
              </tr>
            </thead>
            <tbody>
              {links.map(link => (
                <tr key={link.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium text-slate-900">{link.name}</td>
                  <td className="py-3 px-4 text-slate-600">{link.document}</td>
                  <td className="py-3 px-4 text-slate-600">{link.phone}</td>
                  <td className="py-3 px-4 text-slate-600">
                    {link.approvalStatus === 'PENDING' ? (
                      <select
                        value={approveVehicleTypeId[link.id] ?? link.vehicleTypeId ?? ''}
                        onChange={(e) => setApproveVehicleTypeId((prev) => ({ ...prev, [link.id]: e.target.value }))}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm"
                      >
                        <option value="">Selecione o tipo</option>
                        {vehicleTypes.filter((vt) => vt.active).map((vt) => (
                          <option key={vt.id} value={vt.id}>{vt.name} ({vt.code})</option>
                        ))}
                      </select>
                    ) : (
                      <span>{link.vehicleType ? `${link.vehicleType.name} (${link.vehicleType.code})` : '-'}</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      link.approvalStatus === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                      link.approvalStatus === 'REJECTED' ? 'bg-red-100 text-red-700' :
                      link.approvalStatus === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {statusLabels[link.approvalStatus] ?? link.approvalStatus}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    {link.approvalStatus === 'PENDING' && (
                      <>
                        <button type="button" disabled={!!actionLoading} onClick={() => handleApprove(link.id, link)} className="text-emerald-600 hover:text-emerald-800 text-sm font-medium mr-3">Aprovar</button>
                        <button type="button" disabled={!!actionLoading} onClick={() => handleReject(link.id)} className="text-red-600 hover:text-red-800 text-sm font-medium">Recusar</button>
                      </>
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

export default MotoristasTab;
