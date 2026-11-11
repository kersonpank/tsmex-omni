import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import LinkQuickCreateModal from './LinkQuickCreateModal';

it('aceita CPF sem consulta CNPJ e separa criação de aprovação e convite', () => {
  const props = { form: { document: '52998224725', name: 'Autônomo', phone: '11999999999', carrierType: 'ETC' as const }, setForm: vi.fn(), onLookupCnpj: vi.fn(), saving: false, onClose: vi.fn(), onSave: vi.fn(), onApprove: vi.fn(), onInvite: vi.fn(), fieldClass: '' };
  const view = render(<LinkQuickCreateModal {...props} />);
  expect(screen.queryByRole('button', { name: 'Consultar CNPJ' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cadastrar e selecionar' }));
  expect(props.onSave).toHaveBeenCalledOnce();
  expect(props.onApprove).not.toHaveBeenCalled();
  view.rerender(<LinkQuickCreateModal {...props} createdLinkId="link" />);
  expect(screen.getByDisplayValue('Autônomo')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Aprovar cadastro' }));
  expect(props.onApprove).toHaveBeenCalledOnce();
  expect(props.onInvite).not.toHaveBeenCalled();
  view.rerender(<LinkQuickCreateModal {...props} createdLinkId="link" approved />);
  fireEvent.click(screen.getByRole('button', { name: 'Continuar viagem' }));
  expect(props.onClose).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Gerar convite de acesso (opcional)' }));
  expect(props.onInvite).toHaveBeenCalledOnce();
});
