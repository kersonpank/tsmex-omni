import React, { useState } from 'react';

interface ImportCNPJModalProps {
  isOpen: boolean;
  onClose: () => void;
  cnpjData: any; // Dados retornados da API de CNPJ
  onConfirm: (addToAccount: boolean) => void;
}

const ImportCNPJModal: React.FC<ImportCNPJModalProps> = ({ isOpen, onClose, cnpjData, onConfirm }) => {
  const [addToAccount, setAddToAccount] = useState(false);

  if (!isOpen || !cnpjData) return null;

  const address = cnpjData.address || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-tower-900">Dados Importados do Sintegra</h2>
            <button
              onClick={onClose}
              className="text-tower-400 hover:text-tower-600 text-2xl"
            >
              ×
            </button>
          </div>

          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-xs font-bold text-tower-500 uppercase tracking-wide mb-1">CNPJ</label>
              <div className="p-3 bg-tower-50 border border-tower-200 rounded-xl">
                {cnpjData.cnpj?.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-tower-500 uppercase tracking-wide mb-1">Razão Social</label>
              <div className="p-3 bg-tower-50 border border-tower-200 rounded-xl">
                {cnpjData.legalName || '-'}
              </div>
            </div>

            {cnpjData.tradeName && (
              <div>
                <label className="block text-xs font-bold text-tower-500 uppercase tracking-wide mb-1">Nome Fantasia</label>
                <div className="p-3 bg-tower-50 border border-tower-200 rounded-xl">
                  {cnpjData.tradeName}
                </div>
              </div>
            )}

            {address.street && (
              <div>
                <label className="block text-xs font-bold text-tower-500 uppercase tracking-wide mb-1">Endereço</label>
                <div className="p-3 bg-tower-50 border border-tower-200 rounded-xl">
                  {[address.street, address.number, address.complement].filter(Boolean).join(', ')}
                  {address.neighborhood && ` - ${address.neighborhood}`}
                  {address.city && address.state && ` - ${address.city}/${address.state}`}
                  {address.zipCode && ` - CEP: ${address.zipCode}`}
                </div>
              </div>
            )}

            {cnpjData.phone && (
              <div>
                <label className="block text-xs font-bold text-tower-500 uppercase tracking-wide mb-1">Telefone</label>
                <div className="p-3 bg-tower-50 border border-tower-200 rounded-xl">
                  {cnpjData.phone}
                </div>
              </div>
            )}

            {cnpjData.email && (
              <div>
                <label className="block text-xs font-bold text-tower-500 uppercase tracking-wide mb-1">Email</label>
                <div className="p-3 bg-tower-50 border border-tower-200 rounded-xl">
                  {cnpjData.email}
                </div>
              </div>
            )}
          </div>

          <div className="mb-6 p-4 bg-brand-50 border border-brand-200 rounded-xl">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={addToAccount}
                onChange={e => setAddToAccount(e.target.checked)}
                className="mt-1 rounded"
              />
              <div>
                <div className="font-medium text-brand-900">Esse CNPJ é meu e quero ter os benefícios nele que tenho na minha conta</div>
                <div className="text-sm text-brand-700 mt-1">
                  Se marcado, o CNPJ será adicionado à sua conta e você terá acesso a todos os benefícios e histórico relacionados a ele.
                </div>
              </div>
            </label>
          </div>

          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-tower-100 hover:bg-tower-200 text-tower-700 rounded-xl font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => onConfirm(addToAccount)}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-medium transition-colors"
            >
              Confirmar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImportCNPJModal;
