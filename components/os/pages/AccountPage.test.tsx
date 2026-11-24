import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const changePassword = vi.fn();
const logoutAll = vi.fn();
vi.mock('../../../lib/api', () => ({ accountSecurityApi: { changePassword: (...a: unknown[]) => changePassword(...a), logoutAll: () => logoutAll() } }));

import AccountPage from './AccountPage';
import { useAuthStore } from '../../../store/authStore';

describe('AccountPage', () => {
    beforeEach(() => {
        changePassword.mockReset();
        logoutAll.mockReset();
        useAuthStore.setState({ user: { id: 'u1', email: 'op@hub.com', roles: ['HUB'] }, token: 'old', isAuthenticated: true });
    });

    it('troca a senha e guarda o token novo', async () => {
        changePassword.mockResolvedValue({ success: true, data: { token: 'novo' } });
        render(<MemoryRouter><AccountPage /></MemoryRouter>);
        fireEvent.change(screen.getByPlaceholderText('Senha atual'), { target: { value: 'antiga' } });
        fireEvent.change(screen.getByPlaceholderText(/Nova senha/), { target: { value: 'NovaSenha2026' } });
        fireEvent.change(screen.getByPlaceholderText('Repita a nova senha'), { target: { value: 'NovaSenha2026' } });
        fireEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
        await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Senha alterada/));
        expect(changePassword).toHaveBeenCalledWith('antiga', 'NovaSenha2026');
        expect(useAuthStore.getState().token).toBe('novo');
    });

    it('não envia quando a confirmação não bate', async () => {
        render(<MemoryRouter><AccountPage /></MemoryRouter>);
        fireEvent.change(screen.getByPlaceholderText('Senha atual'), { target: { value: 'antiga' } });
        fireEvent.change(screen.getByPlaceholderText(/Nova senha/), { target: { value: 'NovaSenha2026' } });
        fireEvent.change(screen.getByPlaceholderText('Repita a nova senha'), { target: { value: 'OutraSenha2026' } });
        fireEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
        expect(screen.getByRole('status').textContent).toMatch(/não bate/);
        expect(changePassword).not.toHaveBeenCalled();
    });

    it('sair de todos chama a API e desloga este aparelho', async () => {
        logoutAll.mockResolvedValue({ success: true });
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<MemoryRouter><AccountPage /></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', { name: 'Sair de todos os aparelhos' }));
        await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false));
        expect(logoutAll).toHaveBeenCalled();
    });
});
