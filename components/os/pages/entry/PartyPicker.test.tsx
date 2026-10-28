import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PartyPicker from './PartyPicker';
import type { Person } from '../../../../types/index';
import { cnpjApi, personsApi } from '../../../../lib/api';

vi.mock('../../../../lib/api', () => ({
    cnpjApi: { consult: vi.fn() },
    personsApi: { search: vi.fn(), fromPublicCnpj: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock('../../../manifest/FiscalAddressFields', () => ({ FiscalAddressFields: () => null }));

const person = {
    id: 'p1', documentType: 'CNPJ', document: '11222333000181', legalName: 'EMPRESA',
    city: 'São Paulo', cityIbgeCode: '3550308', state: 'SP', stateRegistration: '999',
} as Person;

describe('PartyPicker: importação de IE', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(personsApi.search).mockResolvedValue({ data: [] } as never);
    });

    it.each(['Remetente', 'Destinatário'])('Importar no cadastro de %s preenche a IE e preserva uma IE já digitada', async (label) => {
        const user = userEvent.setup();
        vi.mocked(cnpjApi.consult).mockResolvedValue({ data: { legalName: 'EMPRESA', stateRegistration: '001234' } } as never);
        render(<PartyPicker label={label} value={null} source="manual" onChange={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: `Cadastrar ${label.toLowerCase()}` }));
        await user.type(screen.getByPlaceholderText('14 dígitos'), person.document);
        await user.click(screen.getByRole('button', { name: 'Importar' }));
        const ie = screen.getByPlaceholderText('Apenas números');
        await waitFor(() => expect(ie).toHaveValue('001234'));
        expect(cnpjApi.consult).toHaveBeenCalledWith(person.document);
        await user.clear(ie);
        await user.type(ie, '777');
        await user.click(screen.getByRole('button', { name: 'Importar' }));
        await waitFor(() => expect(cnpjApi.consult).toHaveBeenCalledTimes(2));
        expect(ie).toHaveValue('777');
    });

    it('mostra falha de importação e mantém a entrada manual disponível', async () => {
        const user = userEvent.setup();
        vi.mocked(cnpjApi.consult).mockRejectedValue({ response: { status: 503 } });
        render(<PartyPicker label="Remetente" value={null} source="manual" onChange={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: 'Cadastrar remetente' }));
        await user.type(screen.getByPlaceholderText('14 dígitos'), person.document);
        await user.click(screen.getByRole('button', { name: 'Importar' }));
        expect(await screen.findByText('Não foi possível importar os dados deste CNPJ agora.')).toBeInTheDocument();
        await user.type(screen.getByPlaceholderText('Apenas números'), '123');
        expect(screen.getByPlaceholderText('Apenas números')).toHaveValue('123');
    });

    it('cadastro público de um toque retorna a pessoa com IE', async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        vi.mocked(personsApi.fromPublicCnpj).mockResolvedValue({ data: person } as never);
        render(<PartyPicker label="Destinatário" value={null} source="manual" onChange={onChange} />);
        await user.type(screen.getByPlaceholderText('Nome, CNPJ ou CPF'), person.document);
        await user.click(screen.getByRole('button', { name: /Cadastrar .* pela Receita/ }));
        await waitFor(() => expect(onChange).toHaveBeenCalledWith(person, 'public_cnpj', 'select'));
    });

    it('ignora a consulta antiga se o operador mudar a busca enquanto ela está pendente', async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        let resolveLookup!: (result: unknown) => void;
        vi.mocked(personsApi.fromPublicCnpj).mockImplementation(() => new Promise((resolve) => { resolveLookup = resolve as (result: unknown) => void; }) as never);
        render(<PartyPicker label="Remetente" value={null} source="manual" onChange={onChange} />);
        const search = screen.getByPlaceholderText('Nome, CNPJ ou CPF');
        await user.type(search, person.document);
        await user.click(screen.getByRole('button', { name: /Cadastrar .* pela Receita/ }));
        await user.clear(search);
        await user.type(search, 'Outro remetente');
        resolveLookup({ data: person });
        await waitFor(() => expect(screen.getByRole('button', { name: /Cadastrar “Outro remetente”/ })).toBeEnabled());
        expect(onChange).not.toHaveBeenCalled();
        expect(search).toHaveValue('Outro remetente');
    });

    it('apresenta divergência com o XML e só troca IE quando o operador escolhe', async () => {
        const user = userEvent.setup();
        render(<PartyPicker label="Remetente" value={person} source="nfe_xml" onChange={vi.fn()} stateRegistrationSuggestion={{ value: '123', source: 'XML da NF-e' }} />);
        expect(screen.getByText('IE: 999')).toBeInTheDocument();
        expect(screen.getByText(/A IE da NF-e é 123/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Editar' }));
        expect(screen.getByPlaceholderText('Apenas números')).toHaveValue('999');
        await user.click(screen.getByRole('button', { name: 'Usar IE da NF-e' }));
        expect(screen.getByPlaceholderText('Apenas números')).toHaveValue('123');
    });
});
