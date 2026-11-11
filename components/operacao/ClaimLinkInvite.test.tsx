import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import api from '../../lib/api';
import ClaimLinkInvite from './ClaimLinkInvite';

vi.mock('../../lib/api', () => ({ default: { post: vi.fn() } }));
it('convite público permite criar acesso e mantém instrução na página em caso de expiração', async () => {
  vi.mocked(api.post).mockRejectedValueOnce({ response: { data: { error: 'Convite inválido ou expirado.' } } });
  render(<MemoryRouter initialEntries={['/claim-link?token=expired']}><ClaimLinkInvite /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'transportador@example.com' } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ativar acesso' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('peça um novo link à operação'));
  expect(screen.getByLabelText('Email')).toHaveValue('transportador@example.com');
  expect(api.post).toHaveBeenCalledWith('/auth/claim-link', { token: 'expired', email: 'transportador@example.com', password: 'senha123' });
});
