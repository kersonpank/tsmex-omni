import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { intakeDemandsApi, nfeDistribuicaoMonitorApi } from '../../lib/api';
import type { NfeDistribuicaoMonitorDetalhe } from '../../lib/api';
import type { Person } from '../../types/index';
import StatusBadge from '../ui/StatusBadge';
import { PersonAutocomplete } from '../ui/PersonAutocomplete';

type FreightTerm = 'CIF' | 'FOB' | 'REDESPACHO';

const FREIGHT_TERM_LABELS: Record<FreightTerm, string> = {
  CIF: 'CIF — remetente paga',
  FOB: 'FOB — destinatário paga',
  REDESPACHO: 'Outro (redespacho)',
};

function formatCnpj(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 14) return digits;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

function formatKg(value?: number): string {
  return typeof value === 'number' ? `${value.toLocaleString('pt-BR')} kg` : '—';
}

function formatMoney(value?: number): string {
  return typeof value === 'number'
    ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : '—';
}

function apiErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const res = (e as { response?: { data?: { error?: string } } }).response;
    if (res?.data?.error) return res.data.error;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

interface NfeDetalheModalProps {
  documentId: string;
  onClose: () => void;
}

const NfeDetalheModal: React.FC<NfeDetalheModalProps> = ({ documentId, onClose }) => {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<NfeDistribuicaoMonitorDetalhe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [freightTerm, setFreightTerm] = useState<FreightTerm>('CIF');
  const [destinatario, setDestinatario] = useState<Person | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    nfeDistribuicaoMonitorApi
      .detail(documentId)
      .then((result) => {
        if (cancelled) return;
        if (result.success) setDoc(result.data);
      })
      .catch((e) => {
        if (!cancelled) setError(apiErrorMessage(e, 'Erro ao carregar detalhe da NF-e.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const handleConfirmArrival = async () => {
    if (!doc?.convertedDemand || !destinatario) return;
    setConfirmBusy(true);
    setConfirmErr(null);
    try {
      const result = await intakeDemandsApi.confirmArrival(doc.convertedDemand.id, {
        destinatarioPersonId: destinatario.id,
        freightTerm,
      });
      const orderId =
        result.success && result.data.order && typeof result.data.order === 'object' && 'id' in result.data.order
          ? String((result.data.order as { id: string }).id)
          : null;
      if (orderId) {
        setConfirmedOrderId(orderId);
      } else {
        setConfirmErr('Chegada confirmada, mas não foi possível identificar o pedido criado.');
      }
    } catch (e) {
      setConfirmErr(apiErrorMessage(e, 'Não foi possível confirmar a chegada.'));
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 dark:bg-tower-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-tower-900 dark:text-white">Detalhe da NF-e</h3>
            {doc && <p className="font-mono text-xs text-tower-500 dark:text-tower-400">…{doc.accessKey.slice(-12)}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-50 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
          >
            Fechar
          </button>
        </div>

        {loading && <div className="py-12 text-center text-tower-500">Carregando...</div>}
        {error && (
          <div className="rounded-xl border border-brand-red-500/30 bg-brand-red-500/10 p-3 text-sm text-brand-red-600 dark:text-brand-red-400">
            {error}
          </div>
        )}

        {!loading && !error && doc && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={doc.status} tone="neutral" />
              <span className="text-xs text-tower-500 dark:text-tower-400">Descoberta em {formatDateTime(doc.createdAt)}</span>
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-tower-700 dark:text-tower-300 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-tower-400 dark:text-tower-500">Fornecedor/Emitente</dt>
                <dd>{doc.cargoData?.emitente.razaoSocial ?? formatCnpj(doc.cnpjEmitente)}</dd>
              </div>
              <div>
                <dt className="text-xs text-tower-400 dark:text-tower-500">Emitente / Hub</dt>
                <dd>{doc.fiscalEmitter.hub ? `${doc.fiscalEmitter.hub.code} - ${doc.fiscalEmitter.hub.name}` : doc.fiscalEmitter.displayName || '—'}</dd>
              </div>
              {doc.cargoData && (
                <>
                  <div>
                    <dt className="text-xs text-tower-400 dark:text-tower-500">Destinatário</dt>
                    <dd>{doc.cargoData.destinatario.razaoSocial || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-tower-400 dark:text-tower-500">Transportador</dt>
                    <dd>{doc.cargoData.transportador?.razaoSocial || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-tower-400 dark:text-tower-500">Valor da nota</dt>
                    <dd>{formatMoney(doc.cargoData.valorTotalNota)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-tower-400 dark:text-tower-500">Peso bruto</dt>
                    <dd>{formatKg(doc.cargoData.pesoBruto)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-tower-400 dark:text-tower-500">Peso líquido</dt>
                    <dd>{formatKg(doc.cargoData.pesoLiquido)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-tower-400 dark:text-tower-500">Volumes</dt>
                    <dd>{doc.cargoData.quantidadeVolumes ?? '—'}</dd>
                  </div>
                </>
              )}
            </dl>

            {doc.cargoData ? (
              doc.cargoData.produtos.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tower-500 dark:text-tower-400">Produtos</h4>
                  <div className="overflow-x-auto rounded-xl border border-tower-200 dark:border-tower-600">
                    <table className="w-full text-xs">
                      <thead className="bg-tower-50 dark:bg-tower-900/60">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-tower-600 dark:text-tower-300">Descrição</th>
                          <th className="px-3 py-2 text-left font-semibold text-tower-600 dark:text-tower-300">NCM</th>
                          <th className="px-3 py-2 text-right font-semibold text-tower-600 dark:text-tower-300">Qtd</th>
                          <th className="px-3 py-2 text-right font-semibold text-tower-600 dark:text-tower-300">Vlr. unit.</th>
                          <th className="px-3 py-2 text-right font-semibold text-tower-600 dark:text-tower-300">Vlr. total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {doc.cargoData.produtos.map((p, i) => (
                          <tr key={i} className="border-t border-tower-100 dark:border-tower-700">
                            <td className="px-3 py-2 text-tower-700 dark:text-tower-300">{p.descricao}</td>
                            <td className="px-3 py-2 font-mono text-tower-600 dark:text-tower-400">{p.ncm}</td>
                            <td className="px-3 py-2 text-right text-tower-700 dark:text-tower-300">{p.quantidade}</td>
                            <td className="px-3 py-2 text-right text-tower-700 dark:text-tower-300">{formatMoney(p.valorUnitario)}</td>
                            <td className="px-3 py-2 text-right text-tower-700 dark:text-tower-300">{formatMoney(p.valorTotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            ) : (
              <p className="text-xs italic text-tower-400 dark:text-tower-500">
                Dados de carga ainda não disponíveis (XML não baixado).
              </p>
            )}

            {doc.convertedDemand && (
              <div className="rounded-xl border border-tower-200 p-4 dark:border-tower-600">
                <p className="mb-3 text-xs text-tower-500 dark:text-tower-400">
                  → Convertida em Demanda #{doc.convertedDemand.orderNumber ?? doc.convertedDemand.id.slice(0, 8)}
                </p>

                {doc.convertedDemand.order?.id || confirmedOrderId ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/orders/${confirmedOrderId ?? doc.convertedDemand!.order!.id}`)}
                    className="cursor-pointer rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    Ir para o pedido
                  </button>
                ) : doc.convertedDemand.status === 'AWAITING_ARRIVAL' ? (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-tower-800 dark:text-tower-100">
                      Confirmar chegada e criar pedido
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(FREIGHT_TERM_LABELS) as FreightTerm[]).map((ft) => (
                        <label
                          key={ft}
                          className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                            freightTerm === ft
                              ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200'
                              : 'border-tower-300 text-tower-600 hover:bg-tower-50 dark:border-tower-600 dark:text-tower-300 dark:hover:bg-tower-800'
                          }`}
                        >
                          <input
                            type="radio"
                            name="freightTerm"
                            className="sr-only"
                            checked={freightTerm === ft}
                            onChange={() => setFreightTerm(ft)}
                          />
                          {FREIGHT_TERM_LABELS[ft]}
                        </label>
                      ))}
                    </div>
                    <PersonAutocomplete
                      label="Destinatário *"
                      value={destinatario}
                      onChange={setDestinatario}
                      placeholder="Buscar destinatário..."
                      required
                    />
                    {confirmErr && (
                      <p className="text-sm text-brand-red-600 dark:text-brand-red-400">{confirmErr}</p>
                    )}
                    <button
                      type="button"
                      disabled={confirmBusy || !destinatario}
                      onClick={() => void handleConfirmArrival()}
                      className="h-11 w-full rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {confirmBusy ? 'Confirmando…' : 'Confirmar chegada e criar pedido'}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-tower-500 dark:text-tower-400">
                    Status da Demanda: {doc.convertedDemand.status}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default NfeDetalheModal;
