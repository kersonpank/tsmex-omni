import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AverbacaoStatus, { averbacaoLabel } from './AverbacaoStatus';

const { ordersFreightApi } = vi.hoisted(() => ({ ordersFreightApi: { averbar: vi.fn() } }));
vi.mock('../../lib/api', () => ({ ordersFreightApi }));

const base = { numeroAverbacao: null, protocolo: null, averbadoAt: null, lastError: null, seguros: [] };

describe('averbacaoLabel', () => {
    it('averbado mostra o número e a seguradora', () => {
        const l = averbacaoLabel({ ...base, status: 'AVERBADO', numeroAverbacao: '0001', seguros: [{ ramo: '54', nomeSeguradora: 'Seg X', numApolice: 'AP1' }] });
        expect(l.text).toBe('Seguro averbado nº 0001');
        expect(l.detail).toBe('Seg X · apólice AP1');
        expect(l.canAverbar).toBe(false);
    });
    it('sem tentativa e pendente: pendente com botão; recusada mostra o motivo', () => {
        expect(averbacaoLabel(null)).toMatchObject({ text: 'Averbação pendente', canAverbar: true });
        expect(averbacaoLabel({ ...base, status: 'FAILED', lastError: '904: Acesso nao autorizado' })).toMatchObject({ text: 'Averbação recusada: 904: Acesso nao autorizado', canAverbar: true });
    });
});

describe('AverbacaoStatus', () => {
    beforeEach(() => { ordersFreightApi.averbar.mockReset(); });

    it('não aparece sem AT&M nem fora de CT-e autorizado', () => {
        const { container, rerender } = render(<AverbacaoStatus orderId="o" calcId="c" calcStatus="CTE_AUTHORIZED" required={false} />);
        expect(container).toBeEmptyDOMElement();
        rerender(<AverbacaoStatus orderId="o" calcId="c" calcStatus="CTE_REJECTED" required />);
        expect(container).toBeEmptyDOMElement();
    });
    it('"Averbar agora" chama a rota e atualiza a tela', async () => {
        ordersFreightApi.averbar.mockResolvedValue({ success: true, data: { outcome: { status: 'AVERBADO' }, averbacao: null } });
        const onDone = vi.fn();
        render(<AverbacaoStatus orderId="o1" calcId="c1" calcStatus="CTE_AUTHORIZED" required averbacao={null} onDone={onDone} />);
        expect(screen.getByText('Averbação pendente')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Averbar agora' }));
        expect(ordersFreightApi.averbar).toHaveBeenCalledWith('o1', 'c1');
        await waitFor(() => expect(onDone).toHaveBeenCalled());
    });
    it('falha mostra o motivo da AT&M', async () => {
        ordersFreightApi.averbar.mockResolvedValue({ success: false, data: { outcome: { status: 'FAILED' }, averbacao: { status: 'FAILED', numeroAverbacao: null, lastError: '010: CNPJ nao autorizado' } } });
        render(<AverbacaoStatus orderId="o1" calcId="c1" calcStatus="CTE_AUTHORIZED" required averbacao={null} />);
        await userEvent.click(screen.getByRole('button', { name: 'Averbar agora' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('010: CNPJ nao autorizado');
    });
});
