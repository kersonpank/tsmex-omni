import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Person } from '../../../../types/index';
import PartySheet from './PartySheet';

const mocks = vi.hoisted(() => ({ update: vi.fn(), swap: vi.fn(), registry: vi.fn(), nfe: vi.fn() }));
vi.mock('../../../../lib/api', () => ({ personsApi: { update: mocks.update }, ordersEntradaApi: { updatePeople: mocks.swap }, locationsApi: {} }));
vi.mock('../../lib/orderPartiesApi', () => ({ orderPartiesApi: { registry: mocks.registry, refreshNfe: mocks.nfe } }));
vi.mock('../entry/PartyPicker', () => ({ default: ({ onChange }: any) => <button onClick={() => onChange({ id: 'other' })}>Selecionar outra</button> }));
const person = { id: 'p1', document: '42024084000143', legalName: 'Empresa atual', stateRegistration: '131223670117', city: 'São Paulo', state: 'SP', cityIbgeCode: '3550308' } as Person;

describe('PartySheet', () => {
    beforeEach(() => { vi.resetAllMocks(); mocks.update.mockResolvedValue({}); mocks.swap.mockResolvedValue({}); });
    it('consulta automaticamente, compara IE e só grava depois de confirmar', async () => {
        mocks.registry.mockResolvedValue({ source: 'sintegra', suggestion: { legalName: 'Empresa atualizada', stateRegistration: '123456789' } });
        const user = userEvent.setup(); const saved = vi.fn();
        render(<PartySheet orderId="o1" role="remetente" person={person} autoLookup onSaved={saved} onClose={vi.fn()} />);
        expect(await screen.findByText('IE no cadastro: 123456789 — atual no sistema: 131223670117')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Usar estes dados' }));
        expect(mocks.update).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Salvar' }));
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('p1', { legalName: 'Empresa atualizada', stateRegistration: '123456789' }));
        expect(saved).toHaveBeenCalledTimes(1);
    });
    it('limpa IE ao marcar não contribuinte', async () => {
        const user = userEvent.setup();
        render(<PartySheet orderId="o1" role="destinatario" person={person} onSaved={vi.fn()} onClose={vi.fn()} />);
        await user.click(screen.getByRole('checkbox', { name: /Isento \/ não contribuinte/ }));
        await user.click(screen.getByRole('button', { name: 'Salvar' }));
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('p1', { legalName: 'Empresa atual', stateRegistration: '' }));
    });
    it('não apaga IE quando a Receita não retorna informação', async () => {
        mocks.registry.mockResolvedValue({ source: 'receita', suggestion: { legalName: 'Empresa atualizada', stateRegistration: null } });
        const user = userEvent.setup();
        render(<PartySheet orderId="o1" role="remetente" person={person} autoLookup onSaved={vi.fn()} onClose={vi.fn()} />);
        await user.click(await screen.findByRole('button', { name: 'Usar estes dados' }));
        await user.click(screen.getByRole('button', { name: 'Salvar' }));
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('p1', { legalName: 'Empresa atualizada', stateRegistration: person.stateRegistration }));
    });
    it('preserva ISENTO explícito ao editar nome', async () => {
        const user = userEvent.setup();
        render(<PartySheet orderId="o1" role="remetente" person={{ ...person, stateRegistration: 'ISENTO' }} onSaved={vi.fn()} onClose={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: 'Salvar' }));
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('p1', { legalName: 'Empresa atual', stateRegistration: 'ISENTO' }));
    });
    it('troca o tomador CIF pelo remetente e exibe a restrição retornada pelo servidor', async () => {
        mocks.swap.mockRejectedValue({ response: { data: { error: 'Tomador bloqueado por CT-e autorizado' } } });
        const user = userEvent.setup();
        render(<PartySheet orderId="o1" role="tomador" replacementRole="remetente" person={person} onSaved={vi.fn()} onClose={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: 'Trocar pessoa' }));
        await user.click(screen.getByRole('button', { name: 'Selecionar outra' }));
        await user.click(screen.getByRole('button', { name: 'Salvar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Tomador bloqueado por CT-e autorizado');
        expect(mocks.swap).toHaveBeenCalledWith('o1', { remetentePersonId: 'other' });
    });
    it('aplica a NF-e sem gravar antes da confirmação', async () => {
        mocks.nfe.mockResolvedValue({ legalName: 'Nome na NF-e', stateRegistration: '123' });
        const user = userEvent.setup();
        render(<PartySheet orderId="o1" role="remetente" person={person} onSaved={vi.fn()} onClose={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: 'Atualizar pela NF-e' }));
        await user.click(await screen.findByRole('button', { name: 'Usar estes dados' }));
        expect(mocks.nfe).toHaveBeenCalledWith('o1', 'remetente', undefined);
        expect(mocks.update).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Razão social')).toHaveValue('Nome na NF-e');
    });
});
