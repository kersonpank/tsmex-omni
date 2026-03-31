import React, { useState } from 'react';
import { maskPhone } from '../../lib/formatters';

interface AddContactModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: {
        name: string;
        role?: string;
        email?: string;
        phone?: string;
        whatsapp?: string;
        isPrimary: boolean;
    }) => void;
    hasPrimary: boolean;
}

const AddContactModal: React.FC<AddContactModalProps> = ({ isOpen, onClose, onSubmit, hasPrimary }) => {
    const [formData, setFormData] = useState({
        name: '',
        role: '',
        email: '',
        phone: '',
        whatsapp: '',
        isPrimary: !hasPrimary,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!formData.name.trim()) {
            setError('Nome é obrigatório');
            return;
        }

        setLoading(true);
        try {
            await onSubmit({
                name: formData.name,
                role: formData.role || undefined,
                email: formData.email || undefined,
                phone: formData.phone || undefined,
                whatsapp: formData.whatsapp || undefined,
                isPrimary: formData.isPrimary,
            });
            // Reset form
            setFormData({
                name: '',
                role: '',
                email: '',
                phone: '',
                whatsapp: '',
                isPrimary: !hasPrimary,
            });
        } catch (err: any) {
            setError(err.message || 'Erro ao adicionar contato');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden">
                <div className="bg-indigo-600 p-6 text-white">
                    <h2 className="text-xl font-bold">Adicionar Contato</h2>
                    <p className="text-indigo-100 text-sm">Adicione um novo contato à sua conta</p>
                </div>

                <form onSubmit={handleSubmit} className="p-8 space-y-6">
                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl text-sm">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                            Nome *
                        </label>
                        <input
                            type="text"
                            placeholder="Nome completo"
                            className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:bg-white outline-none transition-all font-medium"
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                            Cargo
                        </label>
                        <input
                            type="text"
                            placeholder="Ex: Gerente de Logística"
                            className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:bg-white outline-none transition-all font-medium"
                            value={formData.role}
                            onChange={e => setFormData({ ...formData, role: e.target.value })}
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                Email
                            </label>
                            <input
                                type="email"
                                placeholder="email@exemplo.com"
                                className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:bg-white outline-none transition-all font-medium"
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                Telefone
                            </label>
                            <input
                                type="text"
                                placeholder="(11) 99999-9999"
                                className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:bg-white outline-none transition-all font-medium"
                                value={maskPhone(formData.phone)}
                                onChange={e => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '') })}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                            WhatsApp
                        </label>
                        <input
                            type="text"
                            placeholder="(11) 99999-9999"
                            className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:bg-white outline-none transition-all font-medium"
                            value={maskPhone(formData.whatsapp)}
                            onChange={e => setFormData({ ...formData, whatsapp: e.target.value.replace(/\D/g, '') })}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="isPrimary"
                            checked={formData.isPrimary}
                            onChange={e => setFormData({ ...formData, isPrimary: e.target.checked })}
                            className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                        />
                        <label htmlFor="isPrimary" className="text-sm font-medium text-slate-700">
                            Tomador de Decisão
                        </label>
                    </div>

                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 font-bold text-slate-500 hover:text-slate-700 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 px-4 py-3 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50"
                        >
                            {loading ? 'Adicionando...' : 'Adicionar Contato'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddContactModal;
