import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import { useAuthStore } from '../store/authStore';

function HubOnlyPage() {
  return <div>Hub content</div>;
}

function PickerPage() {
  return <div>Picker page</div>;
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: {
        id: '1',
        email: 'multi@exemplo.com',
        roles: ['CLIENT', 'HUB'],
      },
      token: 't',
      isAuthenticated: true,
      currentRole: 'CLIENT',
    });
  });

  it('redireciona para escolher-painel quando usuário multi-papel acessa rota de outro painel', () => {
    render(
      <MemoryRouter initialEntries={['/hub']}>
        <Routes>
          <Route
            path="/hub"
            element={
              <ProtectedRoute allowedRoles={['HUB']}>
                <HubOnlyPage />
              </ProtectedRoute>
            }
          />
          <Route path="/escolher-painel" element={<PickerPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Picker page')).toBeInTheDocument();
    expect(screen.queryByText('Hub content')).not.toBeInTheDocument();
  });

  it('renderiza rota quando papel ativo é permitido', () => {
    useAuthStore.setState({
      currentRole: 'HUB',
      user: {
        id: '1',
        email: 'hubonly@exemplo.com',
        roles: ['HUB'],
      },
    });

    render(
      <MemoryRouter initialEntries={['/hub']}>
        <Routes>
          <Route
            path="/hub"
            element={
              <ProtectedRoute allowedRoles={['HUB']}>
                <HubOnlyPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Hub content')).toBeInTheDocument();
  });
});
