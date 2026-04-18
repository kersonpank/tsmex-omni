import React, { useState, useEffect } from 'react';
import { maskPhone } from '../../lib/formatters';

interface AddCPFModalProps {
  isOpen: boolean;
  onClose: () => void;
  cpf: string;
  onSubmit: (data: {
    cpf: string;
    fullName: string;
    address?: string;
    phone?: string;
    whatsapp?: string;
    email?: string;
  }) => void;
}

const AddCPFModal: React.FC<AddCPFModalProps> = ({ isOpen, onClose, cpf, onSubmit }) => {
  const [formData, setFormData] = useState({
    fullName: '',
    address: '',
    phone: '',
    whatsapp: '',
    email: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFormData({
        fullName: '',
        address: '',
        phone: '',
        whatsapp: '',
        email: '',
      });
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.fullName.trim()) {
      setError('Nome completo é obrigatório.');
      return;
    }

    onSubmit({
      cpf,
      fullName: formData.fullName.trim(),
      address: formData.address.trim() || undefined,
      phone: formData.phone.trim() || undefined,
      whatsapp: formData.whatsapp.trim() || undefined,
      email: formData.email.trim() || undefined,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-tower-900">Cadastrar CPF</h2>
            <button
              onClick={onClose}
              className="text-tower-400 hover:text-tower-600 text-2xl"
            >
              ×
            </button>
          </div>

          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            <p className="font-medium mb-1">CPF: {cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}</p>
            <p>Preencha os dados abaixo para cadastrar este CPF. Essas informações são necessárias para a entrega.</p>
          </div>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-tower-500 uppercase tracking-wide mb-1">
                Nome completo *
              </label>
              <input
                type="text"
                value={formData.fullName}
                onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                className="w-full p-3 bg-tower-50 border border-tower-200 rounded-xl"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-tower-500 uppercase tracking-wide mb-1">
                Endereço
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={e => setFormData({ ...formData, address: e.target.value })}
                className="w-full p-3 bg-tower-50 border border-tower-200 rounded-xl"
                placeholder="Rua, número, complemento"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-tower-500 uppercase tracking-wide mb-1">
                  Telefone
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full p-3 bg-tower-50 border border-tower-200 rounded-xl"
                  placeholder="(00) 0000-0000"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-tower-500 uppercase tracking-wide mb-1">
                  WhatsApp
                </label>
                <input
                  type="text"
                  value={maskPhone(formData.whatsapp)}
                  onChange={e => setFormData({ ...formData, whatsapp: e.target.value.replace(/\D/g, '') })}
                  className="w-full p-3 bg-tower-50 border border-tower-200 rounded-xl"
                  placeholder="(00) 00000-0000"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-tower-500 uppercase tracking-wide mb-1">
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className="w-full p-3 bg-tower-50 border border-tower-200 rounded-xl"
                placeholder="email@exemplo.com"
              />
            </div>

            <div className="flex gap-3 justify-end pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-tower-100 hover:bg-tower-200 text-tower-700 rounded-xl font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-medium transition-colors"
              >
                Cadastrar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddCPFModal;
