import React, { useState } from 'react';

interface AccountCompany {
    id: string;
    cnpj: string;
    legalName: string;
}

interface AddUserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: {
        email: string;
        password: string;
        name: string;
        accountCompanyId?: string;
    }) => void;
    companies: AccountCompany[];
}

const AddUserModal: React.FC<AddUserModalProps> = ({ isOpen, onClose, onSubmit, companies }) => {
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        confirmPassword: '',
        name: '',
        accountCompanyId: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (formData.password.length < 6) {
            setError('Senha deve ter no mínimo 6 caracteres');
            return;
        }

        if (formData.password !== formData.confirmPassword) {
            setError('Senhas não coincidem');
            return;
        }

        if (!formData.name.trim()) {
            setError('Nome é obrigatório');
            return;
        }

        setLoading(true);
        try {
            await onSubmit({
                email: formData.email,
                password: formData.password,
                name: formData.name,
                accountCompanyId: formData.accountCompanyId || undefined,
            });
            // Reset form
            setFormData({
                email: '',
                password: '',
                confirmPassword: '',
                name: '',
                accountCompanyId: '',
            });
        } catch (err: any) {
            setError(err.message || 'Erro ao adicionar usuário');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-tower-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden">
                <div className="bg-brand-600 p-6 text-white">
                    <h2 className="text-xl font-bold">Adicionar Usuário</h2>
                    <p className="text-brand-100 text-sm">Adicione um novo usuário à sua conta</p>
                </div>

                <form onSubmit={handleSubmit} className="p-8 space-y-6">
                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl text-sm">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-tower-400 uppercase tracking-widest mb-2">
                            Nome *
                        </label>
                        <input
                            type="text"
                            placeholder="Nome completo"
                            className="w-full p-3 bg-tower-50 border-2 border-tower-100 rounded-xl focus:border-brand-500 focus:bg-white outline-none transition-all font-medium"
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-tower-400 uppercase tracking-widest mb-2">
                            Email *
                        </label>
                        <input
                            type="email"
                            placeholder="usuario@exemplo.com"
                            className="w-full p-3 bg-tower-50 border-2 border-tower-100 rounded-xl focus:border-brand-500 focus:bg-white outline-none transition-all font-medium"
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            required
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-tower-400 uppercase tracking-widest mb-2">
                                Senha *
                            </label>
                            <input
                                type="password"
                                placeholder="Mínimo 6 caracteres"
                                className="w-full p-3 bg-tower-50 border-2 border-tower-100 rounded-xl focus:border-brand-500 focus:bg-white outline-none transition-all font-medium"
                                value={formData.password}
                                onChange={e => setFormData({ ...formData, password: e.target.value })}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-tower-400 uppercase tracking-widest mb-2">
                                Confirmar Senha *
                            </label>
                            <input
                                type="password"
                                placeholder="Repita a senha"
                                className="w-full p-3 bg-tower-50 border-2 border-tower-100 rounded-xl focus:border-brand-500 focus:bg-white outline-none transition-all font-medium"
                                value={formData.confirmPassword}
                                onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    {companies.length > 0 && (
                        <div>
                            <label className="block text-xs font-bold text-tower-400 uppercase tracking-widest mb-2">
                                CNPJ Associado (Opcional)
                            </label>
                            <select
                                className="w-full p-3 bg-tower-50 border-2 border-tower-100 rounded-xl focus:border-brand-500 focus:bg-white outline-none transition-all font-medium"
                                value={formData.accountCompanyId}
                                onChange={e => setFormData({ ...formData, accountCompanyId: e.target.value })}
                            >
                                <option value="">Nenhum (usuário geral)</option>
                                {companies.map(company => (
                                    <option key={company.id} value={company.id}>
                                        {company.cnpj} - {company.legalName}
                                    </option>
                                ))}
                            </select>
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
                            {loading ? 'Criando...' : 'Criar Usuário'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddUserModal;
