import React, { useState, useEffect } from 'react';
import { locationsApi } from '../../lib/api';
import { DocumentInput } from '../ui/DocumentInput';

interface AddCNPJModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: {
        cnpj: string;
        legalName: string;
        tradeName?: string;
        address?: string;
        city?: string;
        state?: string;
        isPrimary: boolean;
    }) => void;
    hasPrimary: boolean;
    /** CNPJ sugerido (apenas dígitos ou formatado) para preencher ao abrir. Ex.: fluxo "Adicionar CNPJ" no chat. */
    initialCnpj?: string;
}

const AddCNPJModal: React.FC<AddCNPJModalProps> = ({ isOpen, onClose, onSubmit, hasPrimary, initialCnpj }) => {
    const [formData, setFormData] = useState({
        cnpj: '',
        legalName: '',
        tradeName: '',
        address: '',
        city: '',
        state: '',
        isPrimary: !hasPrimary,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [states, setStates] = useState<Array<{ id: string; code: string; name: string }>>([]);
    const [cities, setCities] = useState<Array<{ id: string; name: string; state: { code: string; name: string } }>>([]);
    const [loadingStates, setLoadingStates] = useState(false);
    const [loadingCities, setLoadingCities] = useState(false);

    // Load states on mount
    useEffect(() => {
        if (isOpen) {
            loadStates();
        }
    }, [isOpen]);

    // Pre-fill CNPJ when opening with initialCnpj (e.g. from chat "Adicionar CNPJ" flow)
    useEffect(() => {
        if (isOpen && initialCnpj) {
            const digits = initialCnpj.replace(/\D/g, '');
            setFormData(prev => ({ ...prev, cnpj: digits }));
        }
    }, [isOpen, initialCnpj]);

    // Load cities when state changes
    useEffect(() => {
        if (formData.state) {
            loadCities(formData.state);
        } else {
            setCities([]);
            setFormData(prev => ({ ...prev, city: '' }));
        }
    }, [formData.state]);

    const loadStates = async () => {
        try {
            setLoadingStates(true);
            const response = await locationsApi.getStates();
            setStates(response.data || []);
        } catch (err) {
            console.error('Erro ao carregar estados:', err);
        } finally {
            setLoadingStates(false);
        }
    };

    const loadCities = async (stateCode: string) => {
        try {
            setLoadingCities(true);
            const response = await locationsApi.getCities({ state: stateCode });
            setCities(response.data || []);
        } catch (err) {
            console.error('Erro ao carregar cidades:', err);
            setCities([]);
        } finally {
            setLoadingCities(false);
        }
    };

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const cleanCNPJ = formData.cnpj.replace(/\D/g, '');
        if (cleanCNPJ.length !== 14) {
            setError('CNPJ inválido');
            return;
        }

        if (!formData.legalName.trim()) {
            setError('Razão Social é obrigatória');
            return;
        }

        setLoading(true);
        try {
            await onSubmit({
                ...formData,
                cnpj: cleanCNPJ,
            });
            // Reset form
            setFormData({
                cnpj: '',
                legalName: '',
                tradeName: '',
                address: '',
                city: '',
                state: '',
                isPrimary: !hasPrimary,
            });
            setCities([]);
        } catch (err: any) {
            setError(err.message || 'Erro ao adicionar CNPJ');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-tower-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-tower-800 rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden">
                <div className="bg-brand-600 p-6 text-white">
                    <h2 className="text-xl font-bold">Adicionar CNPJ</h2>
                    <p className="text-brand-100 text-sm">Adicione um novo CNPJ à sua conta</p>
                </div>

                <form onSubmit={handleSubmit} className="p-8 space-y-6">
                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl text-sm">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <DocumentInput
                                label="CNPJ *"
                                value={formData.cnpj}
                                onChange={(v) => setFormData({ ...formData, cnpj: v })}
                                onImport={(data) => {
                                    const addr = data.address || {};
                                    setFormData(prev => ({
                                        ...prev,
                                        legalName: data.legalName || prev.legalName,
                                        tradeName: data.tradeName || prev.tradeName,
                                        address: [addr.street, addr.number, addr.complement, addr.neighborhood].filter(Boolean).join(', ') || prev.address,
                                        city: addr.city || prev.city,
                                        state: addr.state || prev.state,
                                    }));
                                }}
                                placeholder="00.000.000/0000-00"
                                className="w-full p-3 bg-tower-50 border-2 border-tower-100 rounded-xl focus:border-brand-500 focus:bg-white dark:bg-tower-800 outline-none transition-all font-medium"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-tower-400 uppercase tracking-widest mb-2">
                                Razão Social *
                            </label>
                            <input
                                type="text"
                                placeholder="Razão Social Completa"
                                className="w-full p-3 bg-tower-50 border-2 border-tower-100 rounded-xl focus:border-brand-500 focus:bg-white dark:bg-tower-800 outline-none transition-all font-medium"
                                value={formData.legalName}
                                onChange={e => setFormData({ ...formData, legalName: e.target.value })}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-tower-400 uppercase tracking-widest mb-2">
                                Nome Fantasia
                            </label>
                            <input
                                type="text"
                                placeholder="Nome Fantasia"
                                className="w-full p-3 bg-tower-50 border-2 border-tower-100 rounded-xl focus:border-brand-500 focus:bg-white dark:bg-tower-800 outline-none transition-all font-medium"
                                value={formData.tradeName}
                                onChange={e => setFormData({ ...formData, tradeName: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-tower-400 uppercase tracking-widest mb-2">
                                Estado / Cidade
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <select
                                    className="p-3 bg-tower-50 border-2 border-tower-100 rounded-xl focus:border-brand-500 focus:bg-white dark:bg-tower-800 outline-none transition-all font-medium"
                                    value={formData.state}
                                    onChange={e => setFormData({ ...formData, state: e.target.value, city: '' })}
                                    disabled={loadingStates}
                                >
                                    <option value="">Selecione o estado</option>
                                    {states.map(state => (
                                        <option key={state.id} value={state.code}>
                                            {state.code} - {state.name}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    className="p-3 bg-tower-50 border-2 border-tower-100 rounded-xl focus:border-brand-500 focus:bg-white dark:bg-tower-800 outline-none transition-all font-medium"
                                    value={formData.city}
                                    onChange={e => setFormData({ ...formData, city: e.target.value })}
                                    disabled={!formData.state || loadingCities}
                                >
                                    <option value="">{loadingCities ? 'Carregando...' : formData.state ? 'Selecione a cidade' : 'Selecione o estado primeiro'}</option>
                                    {cities.map(city => (
                                        <option key={city.id} value={city.name}>
                                            {city.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-tower-400 uppercase tracking-widest mb-2">
                                Endereço
                            </label>
                            <input
                                type="text"
                                placeholder="Endereço completo"
                                className="w-full p-3 bg-tower-50 border-2 border-tower-100 rounded-xl focus:border-brand-500 focus:bg-white dark:bg-tower-800 outline-none transition-all font-medium"
                                value={formData.address}
                                onChange={e => setFormData({ ...formData, address: e.target.value })}
                            />
                        </div>
                    </div>

                    {hasPrimary && (
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="isPrimary"
                                checked={formData.isPrimary}
                                onChange={e => setFormData({ ...formData, isPrimary: e.target.checked })}
                                className="w-4 h-4 text-brand-600 border-tower-300 rounded focus:ring-brand-500"
                            />
                            <label htmlFor="isPrimary" className="text-sm font-medium text-tower-700">
                                Marcar como CNPJ primário
                            </label>
                        </div>
                    )}

                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 font-bold text-tower-500 hover:text-tower-700 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 px-4 py-3 bg-brand-600 text-white font-bold rounded-2xl hover:bg-brand-700 transition-all shadow-lg shadow-brand-200 disabled:opacity-50"
                        >
                            {loading ? 'Adicionando...' : 'Adicionar CNPJ'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddCNPJModal;
