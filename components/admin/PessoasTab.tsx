import React, { useState, useEffect } from 'react';
import { personsApi, vehicleTypesApi, hubsApi, locationsApi } from '../../lib/api';
import type { Person, PersonDocumentType, CreatePersonRequest } from '../../types/index';
import type { VehicleType, Hub } from '../../types/index';
import { DocumentInput } from '../ui/DocumentInput';
import { CityAutocomplete } from '../ui/CityAutocomplete';
import { maskPhone } from '../../lib/formatters';

const ROLES = [
  { key: 'cliente', label: 'Cliente', hasRelation: (p: Person) => p.clients && p.clients.length > 0 },
  { key: 'motorista', label: 'Motorista', hasRelation: (p: Person) => p.links && p.links.length > 0 },
  { key: 'agente_cobranca', label: 'Agente de Cobrança', hasRelation: () => false },
  { key: 'empresa_filial', label: 'Empresa / Filial', hasRelation: (p: Person) => ((p as any).hubs?.length ?? 0) > 0 },
  { key: 'funcionario', label: 'Funcionário', hasRelation: () => false },
  { key: 'usuario_sistema', label: 'Usuário do Sistema', hasRelation: () => false },
  { key: 'vendedor', label: 'Vendedor', hasRelation: () => false },
  { key: 'fornecedor', label: 'Fornecedor', hasRelation: () => false },
] as const;

function formatDocument(doc: string, type: PersonDocumentType): string {
  const d = doc.replace(/\D/g, '');
  if (type === 'CPF' && d.length === 11) {
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (type === 'CNPJ' && d.length === 14) {
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return doc;
}

const PessoasTab: React.FC = () => {
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterDocumentType, setFilterDocumentType] = useState<'CPF' | 'CNPJ' | ''>('');
  const [filterName, setFilterName] = useState('');
  const [filterHasClient, setFilterHasClient] = useState<'true' | 'false' | ''>('');
  const [filterHasLink, setFilterHasLink] = useState<'true' | 'false' | ''>('');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [showAddLinkModal, setShowAddLinkModal] = useState(false);
  const [showAddHubModal, setShowAddHubModal] = useState(false);
  const [showLinkAsEmitterModal, setShowLinkAsEmitterModal] = useState(false);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadPersons = async () => {
    try {
      setLoading(true);
      setError(null);
      const params: Parameters<typeof personsApi.list>[0] = {};
      if (filterDocumentType) params.documentType = filterDocumentType;
      if (filterName) params.name = filterName;
      if (filterHasClient) params.hasClient = filterHasClient === 'true';
      if (filterHasLink) params.hasLink = filterHasLink === 'true';
      const res = await personsApi.list(params);
      setPersons(res.data);
    } catch (err: any) {
      console.error('Erro ao carregar pessoas:', err);
      setError(err.response?.data?.error || 'Erro ao carregar pessoas');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      setError(null);
      await personsApi.sync();
      await loadPersons();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao sincronizar');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadPersons();
  }, [filterDocumentType, filterHasClient, filterHasLink]);

  useEffect(() => {
    vehicleTypesApi.list().then(res => setVehicleTypes(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!filterName) {
      loadPersons();
    }
  }, [filterName]);

  const handleSearch = () => {
    loadPersons();
  };

  const openDetail = async (id: string) => {
    setSelectedPersonId(id);
    setDetailLoading(true);
    setSelectedPerson(null);
    try {
      const res = await personsApi.getById(id);
      setSelectedPerson(res.data);
    } catch (err: any) {
      console.error('Erro ao carregar detalhe:', err);
      setSelectedPersonId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedPersonId(null);
    setSelectedPerson(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-lg font-bold text-tower-800">Cadastro de Pessoas</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 bg-tower-100 text-tower-700 rounded-lg text-sm font-medium hover:bg-tower-200 disabled:opacity-50"
          >
            {syncing ? 'Sincronizando...' : 'Sincronizar pessoas'}
          </button>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
          >
            Nova Pessoa
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-tower-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-tower-500 mb-1">Tipo</label>
          <select
            value={filterDocumentType}
            onChange={e => setFilterDocumentType(e.target.value as 'CPF' | 'CNPJ' | '')}
            className="border border-tower-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            <option value="CPF">CPF</option>
            <option value="CNPJ">CNPJ</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-tower-500 mb-1">Nome / Documento</label>
          <input
            type="text"
            value={filterName}
            onChange={e => setFilterName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Buscar..."
            className="border border-tower-300 rounded-lg px-3 py-2 text-sm w-48"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-tower-500 mb-1">Cliente</label>
          <select
            value={filterHasClient}
            onChange={e => setFilterHasClient(e.target.value as 'true' | 'false' | '')}
            className="border border-tower-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-tower-500 mb-1">Motorista</label>
          <select
            value={filterHasLink}
            onChange={e => setFilterHasLink(e.target.value as 'true' | 'false' | '')}
            className="border border-tower-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </select>
        </div>
        <button
          type="button"
          onClick={handleSearch}
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
        >
          Buscar
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white border border-tower-200 rounded-xl overflow-hidden">
          {persons.length === 0 ? (
            <div className="p-12 text-center text-tower-500">
              <p className="mb-4">Nenhuma pessoa encontrada.</p>
              <p className="text-sm mb-4">Clique em <strong>Sincronizar pessoas</strong> para importar clientes e motoristas existentes, ou cadastre uma nova pessoa.</p>
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {syncing ? 'Sincronizando...' : 'Sincronizar pessoas'}
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-tower-200">
                <thead className="bg-tower-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-tower-600 uppercase">Documento</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-tower-600 uppercase">Nome / Razão Social</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-tower-600 uppercase">Tipo</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-tower-600 uppercase">Papéis</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-tower-600 uppercase">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tower-200">
                  {persons.map(p => (
                    <tr key={p.id} className="hover:bg-tower-50">
                      <td className="px-4 py-3 text-sm font-mono text-tower-700">
                        {formatDocument(p.document, p.documentType)}
                      </td>
                      <td className="px-4 py-3 text-sm text-tower-900">
                        {p.legalName}
                        {p.tradeName && (
                          <span className="block text-xs text-tower-500">{p.tradeName}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.documentType === 'CPF' ? 'bg-tower-100 text-tower-700' : 'bg-brand-100 text-brand-700'}`}>
                          {p.documentType}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {p.clients && p.clients.length > 0 && (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-brand-100 text-brand-700">
                              Cliente
                            </span>
                          )}
                          {p.links && p.links.length > 0 && (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                              Motorista
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openDetail(p.id)}
                          className="text-brand-600 hover:text-brand-800 text-sm font-medium"
                        >
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal detalhe */}
      {selectedPersonId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={closeDetail}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {detailLoading ? (
              <div className="p-12 flex justify-center">
                <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : selectedPerson ? (
              <>
                <div className="p-6 border-b border-tower-200">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-xl font-bold text-tower-900">{selectedPerson.legalName}</h3>
                      {selectedPerson.tradeName && (
                        <p className="text-sm text-tower-500">{selectedPerson.tradeName}</p>
                      )}
                      <p className="text-sm font-mono text-tower-600 mt-1">
                        {formatDocument(selectedPerson.document, selectedPerson.documentType)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeDetail}
                      className="text-tower-400 hover:text-tower-600 text-2xl leading-none"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="p-6 space-y-6">
                  <div>
                    <h4 className="text-sm font-semibold text-tower-700 mb-2">Dados gerais</h4>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <dt className="text-tower-500">Tipo</dt>
                      <dd>{selectedPerson.documentType}</dd>
                      <dt className="text-tower-500">Documento</dt>
                      <dd className="font-mono">{formatDocument(selectedPerson.document, selectedPerson.documentType)}</dd>
                      {selectedPerson.cep && (
                        <>
                          <dt className="text-tower-500">CEP</dt>
                          <dd>{selectedPerson.cep}</dd>
                        </>
                      )}
                      {selectedPerson.address && (
                        <>
                          <dt className="text-tower-500">Endereço</dt>
                          <dd>{selectedPerson.address}{selectedPerson.number ? `, ${selectedPerson.number}` : ''}{selectedPerson.complement ? ` - ${selectedPerson.complement}` : ''}</dd>
                        </>
                      )}
                      {(selectedPerson.neighborhood || selectedPerson.city) && (
                        <>
                          <dt className="text-tower-500">Bairro / Cidade</dt>
                          <dd>{[selectedPerson.neighborhood, selectedPerson.city].filter(Boolean).join(' - ')}</dd>
                        </>
                      )}
                      {selectedPerson.state && (
                        <>
                          <dt className="text-tower-500">Estado</dt>
                          <dd>{selectedPerson.state}</dd>
                        </>
                      )}
                      {selectedPerson.country && (
                        <>
                          <dt className="text-tower-500">País</dt>
                          <dd>{selectedPerson.country}</dd>
                        </>
                      )}
                      {selectedPerson.stateRegistration && (
                        <>
                          <dt className="text-tower-500">Inscrição Estadual</dt>
                          <dd>{selectedPerson.stateRegistration}</dd>
                        </>
                      )}
                      {selectedPerson.municipalRegistration && (
                        <>
                          <dt className="text-tower-500">Inscrição Municipal</dt>
                          <dd>{selectedPerson.municipalRegistration}</dd>
                        </>
                      )}
                    </dl>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-tower-700 mb-2">Relacionamentos</h4>
                    <div className="flex flex-wrap gap-2">
                      {ROLES.map(role => {
                        const active = role.hasRelation(selectedPerson);
                        return (
                          <span
                            key={role.key}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium ${active ? 'bg-brand-100 text-brand-800' : 'bg-tower-100 text-tower-600'}`}
                          >
                            {active ? '✓' : '+'} {role.label}
                          </span>
                        );
                      })}
                    </div>
                    {(selectedPerson.clients?.length ?? 0) > 0 && (
                      <p className="mt-2 text-sm text-tower-600">
                        Cliente: <span className="font-medium">{(selectedPerson.clients as { companyName?: string; id: string }[])[0]?.companyName ?? 'Registro ativo'}</span>
                        {' '}(ID: {(selectedPerson.clients as { id: string }[])[0]?.id?.slice(0, 8)})
                      </p>
                    )}
                    {(selectedPerson.links?.length ?? 0) > 0 && (
                      <p className="mt-1 text-sm text-tower-600">
                        Motorista: <span className="font-medium">{(selectedPerson.links as { name?: string; id: string }[])[0]?.name ?? 'Registro ativo'}</span>
                        {' '}(ID: {(selectedPerson.links as { id: string }[])[0]?.id?.slice(0, 8)})
                      </p>
                    )}
                    {((selectedPerson as any).hubs?.length ?? 0) > 0 && (
                      <div className="mt-2">
                        <p className="text-sm font-medium text-tower-700">Emissor dos Hubs</p>
                        <ul className="mt-1 space-y-1">
                          {((selectedPerson as any).hubs as { id: string; name: string; code: string }[]).map(h => (
                            <li key={h.id} className="flex items-center justify-between text-sm text-tower-600">
                              <span>{h.name} ({h.code})</span>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await hubsApi.update(h.id, { personId: null });
                                    if (selectedPersonId) openDetail(selectedPersonId);
                                    loadPersons();
                                  } catch (err: any) {
                                    setError(err.response?.data?.error || 'Erro ao desvincular');
                                  }
                                }}
                                className="text-red-600 hover:text-red-800 text-xs font-medium"
                              >
                                Desvincular
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="p-6 border-t border-tower-200 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => { setShowEditModal(true); }}
                      className="px-3 py-1.5 bg-tower-100 text-tower-700 rounded-lg text-sm font-medium hover:bg-tower-200"
                    >
                      Editar
                    </button>
                    {selectedPerson.documentType === 'CNPJ' && (!selectedPerson.clients || selectedPerson.clients.length === 0) && (
                      <button
                        type="button"
                        onClick={() => setShowAddClientModal(true)}
                        className="px-3 py-1.5 bg-brand-100 text-brand-700 rounded-lg text-sm font-medium hover:bg-brand-200"
                      >
                        + Adicionar como Cliente
                      </button>
                    )}
                    {(!selectedPerson.links || selectedPerson.links.length === 0) && (
                      <button
                        type="button"
                        onClick={() => setShowAddLinkModal(true)}
                        className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200"
                      >
                        + Adicionar como Motorista
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowAddHubModal(true)}
                      className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-200"
                    >
                      Adicionar operador de Hub
                    </button>
                    {selectedPerson.documentType === 'CNPJ' && (
                      <button
                        type="button"
                        onClick={() => setShowLinkAsEmitterModal(true)}
                        className="px-3 py-1.5 bg-brand-100 text-brand-700 rounded-lg text-sm font-medium hover:bg-brand-200"
                      >
                        + Empresa / Filial
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-tower-500">Não foi possível carregar os dados.</div>
            )}
          </div>
        </div>
      )}

      {/* Modal Nova Pessoa */}
      {showCreateModal && (
        <PersonFormModal
          mode="create"
          initialValues={{}}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => { setShowCreateModal(false); loadPersons(); }}
          formError={formError}
          formSaving={formSaving}
          setFormError={setFormError}
          setFormSaving={setFormSaving}
        />
      )}

      {/* Modal Editar Pessoa */}
      {showEditModal && selectedPerson && (
        <PersonFormModal
          mode="edit"
          personId={selectedPerson.id}
          initialValues={{
            documentType: selectedPerson.documentType,
            document: selectedPerson.document,
            legalName: selectedPerson.legalName,
            tradeName: selectedPerson.tradeName ?? '',
            cep: selectedPerson.cep ?? '',
            address: selectedPerson.address ?? '',
            number: selectedPerson.number ?? '',
            complement: selectedPerson.complement ?? '',
            neighborhood: selectedPerson.neighborhood ?? '',
            city: selectedPerson.city ?? '',
            state: selectedPerson.state ?? '',
            country: selectedPerson.country ?? 'BRASIL',
          }}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => { setShowEditModal(false); if (selectedPersonId) openDetail(selectedPersonId); loadPersons(); }}
          formError={formError}
          formSaving={formSaving}
          setFormError={setFormError}
          setFormSaving={setFormSaving}
        />
      )}

      {/* Modal Adicionar como Cliente */}
      {showAddClientModal && selectedPersonId && (
        <AddClientModal
          personId={selectedPersonId}
          onClose={() => setShowAddClientModal(false)}
          onSuccess={() => { setShowAddClientModal(false); if (selectedPersonId) openDetail(selectedPersonId); loadPersons(); }}
        />
      )}

      {/* Modal Adicionar como Motorista */}
      {showAddLinkModal && selectedPersonId && (
        <AddLinkModal
          personId={selectedPersonId}
          vehicleTypes={vehicleTypes}
          onClose={() => setShowAddLinkModal(false)}
          onSuccess={() => { setShowAddLinkModal(false); if (selectedPersonId) openDetail(selectedPersonId); loadPersons(); }}
        />
      )}

      {/* Modal Adicionar como operador de Hub */}
      {showAddHubModal && selectedPersonId && (
        <AddHubModal
          personId={selectedPersonId}
          onClose={() => setShowAddHubModal(false)}
          onSuccess={() => { setShowAddHubModal(false); if (selectedPersonId) openDetail(selectedPersonId); loadPersons(); }}
        />
      )}

      {/* Modal Vincular como emissor de Hub (Empresa / Filial) */}
      {showLinkAsEmitterModal && selectedPersonId && selectedPerson && (
        <LinkPersonAsEmitterModal
          personId={selectedPersonId}
          personLegalName={selectedPerson.legalName}
          onClose={() => setShowLinkAsEmitterModal(false)}
          onSuccess={() => { setShowLinkAsEmitterModal(false); if (selectedPersonId) openDetail(selectedPersonId); loadPersons(); }}
        />
      )}
    </div>
  );
};

// Form modal create/edit Person
const defaultPersonForm = {
  documentType: 'CPF' as PersonDocumentType,
  document: '',
  legalName: '',
  tradeName: '',
  cep: '',
  address: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  country: 'BRASIL',
};

function PersonFormModal({
  mode,
  personId,
  initialValues,
  onClose,
  onSuccess,
  formError,
  formSaving,
  setFormError,
  setFormSaving,
}: {
  mode: 'create' | 'edit';
  personId?: string;
  initialValues: Partial<CreatePersonRequest & { tradeName: string; cep: string; number: string; complement: string; neighborhood: string; city: string; state: string; country: string }>;
  onClose: () => void;
  onSuccess: () => void;
  formError: string | null;
  formSaving: boolean;
  setFormError: (v: string | null) => void;
  setFormSaving: (v: boolean) => void;
}) {
  const [form, setForm] = useState({ ...defaultPersonForm, ...initialValues });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSaving(true);
    try {
      const payload = {
        documentType: form.documentType,
        document: form.document.replace(/\D/g, ''),
        legalName: form.legalName,
        tradeName: form.tradeName || undefined,
        cep: form.cep || undefined,
        address: form.address || undefined,
        number: form.number || undefined,
        complement: form.complement || undefined,
        neighborhood: form.neighborhood || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        country: form.country || 'BRASIL',
      };
      if (mode === 'create') {
        await personsApi.create(payload);
      } else if (personId) {
        await personsApi.update(personId, payload);
      }
      onSuccess();
    } catch (err: any) {
      setFormError(err.response?.data?.error || err.message || 'Erro ao salvar');
    } finally {
      setFormSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose} role="dialog">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-tower-900 mb-4">{mode === 'create' ? 'Nova Pessoa' : 'Editar Pessoa'}</h3>
        {formError && <p className="text-red-600 text-sm mb-4">{formError}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Tipo documento</label>
            <select
              value={form.documentType}
              onChange={e => setForm(f => ({ ...f, documentType: e.target.value as PersonDocumentType }))}
              className="w-full border border-tower-300 rounded-lg px-3 py-2"
              required
            >
              <option value="CPF">CPF</option>
              <option value="CNPJ">CNPJ</option>
            </select>
          </div>
          <DocumentInput
            label="Documento"
            value={form.document}
            onChange={(v) => setForm(f => ({ ...f, document: v }))}
            documentType={form.documentType}
            onImport={form.documentType === 'CNPJ' ? (data) => setForm(f => ({
              ...f,
              legalName: data.legalName || f.legalName,
              tradeName: data.tradeName || f.tradeName,
              address: data.address ? [data.address.street, data.address.number, data.address.complement, data.address.neighborhood].filter(Boolean).join(', ') : f.address,
              city: data.address?.city || f.city,
              state: data.address?.state || f.state,
              cep: data.address?.zipCode || f.cep,
            })) : undefined}
            placeholder={form.documentType === 'CPF' ? '11 dígitos' : '14 dígitos'}
            required
            className="w-full border border-tower-300 rounded-lg px-3 py-2"
          />
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Nome / Razão social</label>
            <input
              type="text"
              value={form.legalName}
              onChange={e => setForm(f => ({ ...f, legalName: e.target.value }))}
              className="w-full border border-tower-300 rounded-lg px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Fantasia</label>
            <input
              type="text"
              value={form.tradeName}
              onChange={e => setForm(f => ({ ...f, tradeName: e.target.value }))}
              className="w-full border border-tower-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">CEP</label>
              <input type="text" value={form.cep} onChange={e => setForm(f => ({ ...f, cep: e.target.value }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Cidade</label>
              <input type="text" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Endereço</label>
            <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" />
          </div>
          <div className="flex gap-2 justify-end pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-tower-600 hover:bg-tower-100 rounded-lg">Cancelar</button>
            <button type="submit" disabled={formSaving} className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">
              {formSaving ? 'Salvando...' : 'Gravar Pessoa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddClientModal({ personId, onClose, onSuccess }: { personId: string; onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await personsApi.addClient(personId, { email, password, contactName, phone });
      onSuccess();
    } catch (error: any) {
      setErr(error.response?.data?.error || error.message || 'Erro ao adicionar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose} role="dialog">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-tower-900 mb-4">Adicionar como Cliente</h3>
        {err && <p className="text-red-600 text-sm mb-4">{err}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full border border-tower-300 rounded-lg px-3 py-2" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Senha</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full border border-tower-300 rounded-lg px-3 py-2" required minLength={6} />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Nome do contato</label>
            <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} className="w-full border border-tower-300 rounded-lg px-3 py-2" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Telefone</label>
            <input type="tel" value={maskPhone(phone)} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} className="w-full border border-tower-300 rounded-lg px-3 py-2" placeholder="(11) 99999-9999" required maxLength={15} />
          </div>
          <div className="flex gap-2 justify-end pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-tower-600 hover:bg-tower-100 rounded-lg">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">{saving ? 'Salvando...' : 'Adicionar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddLinkModal({
  personId,
  vehicleTypes,
  onClose,
  onSuccess,
}: {
  personId: string;
  vehicleTypes: VehicleType[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleTypeId, setVehicleTypeId] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [homeBase, setHomeBase] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await personsApi.addLink(personId, { email, password, name, phone, vehicleTypeId, vehiclePlate, homeBase });
      onSuccess();
    } catch (error: any) {
      setErr(error.response?.data?.error || error.message || 'Erro ao adicionar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose} role="dialog">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-tower-900 mb-4">Adicionar como Motorista</h3>
        {err && <p className="text-red-600 text-sm mb-4">{err}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full border border-tower-300 rounded-lg px-3 py-2" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Senha</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full border border-tower-300 rounded-lg px-3 py-2" required minLength={6} />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Nome</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full border border-tower-300 rounded-lg px-3 py-2" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Telefone</label>
            <input type="tel" value={maskPhone(phone)} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} className="w-full border border-tower-300 rounded-lg px-3 py-2" placeholder="(11) 99999-9999" required maxLength={15} />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Tipo de veículo</label>
            <select value={vehicleTypeId} onChange={e => setVehicleTypeId(e.target.value)} className="w-full border border-tower-300 rounded-lg px-3 py-2" required>
              <option value="">Selecione</option>
              {vehicleTypes.map(vt => (
                <option key={vt.id} value={vt.id}>{vt.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Placa</label>
            <input type="text" value={vehiclePlate} onChange={e => setVehiclePlate(e.target.value)} className="w-full border border-tower-300 rounded-lg px-3 py-2" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Base</label>
            <input type="text" value={homeBase} onChange={e => setHomeBase(e.target.value)} placeholder="Cidade base" className="w-full border border-tower-300 rounded-lg px-3 py-2" required />
          </div>
          <div className="flex gap-2 justify-end pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-tower-600 hover:bg-tower-100 rounded-lg">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Salvando...' : 'Adicionar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const HUB_PERMISSIONS = [
  { id: 'entrada', label: 'Entrada de mercadorias' },
  { id: 'pedidos', label: 'Pedidos' },
  { id: 'manifestos', label: 'Manifestos (viagens)' },
  { id: 'demandas', label: 'Demandas' },
];

function AddHubModal({
  personId,
  onClose,
  onSuccess,
}: {
  personId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [hubId, setHubId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    hubsApi.list().then(r => setHubs((r as any)?.data ?? r ?? [])).catch(() => setHubs([]));
  }, []);

  const togglePermission = (id: string) => {
    setPermissions(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await personsApi.addHub(personId, { hubId, email, password, permissions });
      onSuccess();
    } catch (error: any) {
      setErr(error.response?.data?.error || error.message || 'Erro ao adicionar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose} role="dialog">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-tower-900 mb-4">Adicionar como operador de Hub</h3>
        {err && <p className="text-red-600 text-sm mb-4">{err}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Hub</label>
            <select value={hubId} onChange={e => setHubId(e.target.value)} className="w-full border border-tower-300 rounded-lg px-3 py-2" required>
              <option value="">Selecione o hub</option>
              {hubs.map(h => (
                <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Permissões</label>
            <div className="space-y-2 mt-1">
              {HUB_PERMISSIONS.map(p => (
                <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={permissions.includes(p.id)}
                    onChange={() => togglePermission(p.id)}
                    className="rounded"
                  />
                  <span className="text-sm text-tower-700">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full border border-tower-300 rounded-lg px-3 py-2" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 mb-1">Senha</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full border border-tower-300 rounded-lg px-3 py-2" required minLength={6} />
          </div>
          <div className="flex gap-2 justify-end pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-tower-600 hover:bg-tower-100 rounded-lg">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">{saving ? 'Salvando...' : 'Adicionar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Modal: vincular esta Pessoa (CNPJ) como emissor de um Hub existente ou criar novo Hub */
function LinkPersonAsEmitterModal({
  personId,
  personLegalName,
  onClose,
  onSuccess,
}: {
  personId: string;
  personLegalName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<'link' | 'create'>('link');
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [hubId, setHubId] = useState('');
  const [states, setStates] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [createForm, setCreateForm] = useState({
    name: personLegalName,
    code: '',
    city: '',
    state: '',
    address: '',
    phone: '',
    email: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    hubsApi.list().then((r: any) => setHubs(Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : [])).catch(() => setHubs([]));
  }, []);
  useEffect(() => {
    if (mode === 'create') {
      locationsApi.getStates().then((r: any) => setStates((r?.data ?? r) || [])).catch(() => []);
    }
  }, [mode]);
  useEffect(() => {
    setCreateForm(f => ({ ...f, name: personLegalName }));
  }, [personLegalName]);

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await hubsApi.update(hubId, { personId });
      onSuccess();
    } catch (error: any) {
      setErr(error.response?.data?.error || error.message || 'Erro ao vincular');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.code.trim() || !createForm.city.trim() || !createForm.state.trim()) {
      setErr('Preencha nome, código, cidade e estado.');
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      await hubsApi.create({
        name: createForm.name,
        code: createForm.code,
        city: createForm.city,
        state: createForm.state,
        address: createForm.address || undefined,
        phone: createForm.phone || undefined,
        email: createForm.email || undefined,
        personId,
      });
      onSuccess();
    } catch (error: any) {
      setErr(error.response?.data?.error || error.message || 'Erro ao criar Hub');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose} role="dialog">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-tower-900 mb-2">Vincular como emissor de Hub</h3>
        <p className="text-sm text-tower-600 mb-4">Esta pessoa (CNPJ) será usada como emissor para CT-e/Minuta.</p>
        {err && <p className="text-red-600 text-sm mb-4">{err}</p>}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setMode('link')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${mode === 'link' ? 'bg-brand-600 text-white' : 'bg-tower-100 text-tower-700'}`}
          >
            Vincular a Hub existente
          </button>
          <button
            type="button"
            onClick={() => setMode('create')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${mode === 'create' ? 'bg-brand-600 text-white' : 'bg-tower-100 text-tower-700'}`}
          >
            Criar novo Hub
          </button>
        </div>
        {mode === 'link' ? (
          <form onSubmit={handleLink} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Hub</label>
              <select value={hubId} onChange={e => setHubId(e.target.value)} className="w-full border border-tower-300 rounded-lg px-3 py-2" required>
                <option value="">Selecione o hub</option>
                {hubs.map(h => (
                  <option key={h.id} value={h.id}>{h.name} ({h.code}){h.personId === personId ? ' – já vinculado' : ''}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-tower-600 hover:bg-tower-100 rounded-lg">Cancelar</button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">{saving ? 'Salvando...' : 'Vincular'}</button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Nome *</label>
              <input type="text" value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Código *</label>
              <input type="text" value={createForm.code} onChange={e => setCreateForm(f => ({ ...f, code: e.target.value }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" required placeholder="ex: SP-GRU" />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Estado *</label>
              <select value={createForm.state} onChange={e => setCreateForm(f => ({ ...f, state: e.target.value, city: '' }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" required>
                <option value="">Selecione</option>
                {states.map(s => (
                  <option key={s.id} value={s.code}>{s.code} – {s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Cidade *</label>
              <CityAutocomplete
                value={createForm.city && createForm.state ? `${createForm.city}, ${createForm.state}` : createForm.city}
                onChange={v => {
                  const parts = v.split(', ');
                  if (parts.length >= 2) setCreateForm(f => ({ ...f, city: parts[0], state: parts[1] }));
                  else setCreateForm(f => ({ ...f, city: v }));
                }}
                onSelect={(city, state) => setCreateForm(f => ({ ...f, city, state }))}
                state={createForm.state || undefined}
                placeholder="Ex: São Paulo"
                required
                className="w-full border border-tower-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 mb-1">Endereço</label>
              <input type="text" value={createForm.address} onChange={e => setCreateForm(f => ({ ...f, address: e.target.value }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium text-tower-700 mb-1">Telefone</label>
                <input type="tel" value={maskPhone(createForm.phone)} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '') }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" placeholder="(11) 99999-9999" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 mb-1">E-mail</label>
                <input type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} className="w-full border border-tower-300 rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-tower-600 hover:bg-tower-100 rounded-lg">Cancelar</button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">{saving ? 'Criando...' : 'Criar Hub'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default PessoasTab;
