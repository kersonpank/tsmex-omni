import React, { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../../lib/api';
import { clearResources } from '../lib/resource';
import { buildPersonFromCnpj, CepField, CityPicker, HubSelect, PersonPicker, type CityValue, type PersonSummary } from './pickers';

/** Os seletores falam com o cliente de API real; só o transporte do axios é simulado. */

const ok = (data: unknown) => ({ success: true, data });

const ANA = { id: 'p-ana', documentType: 'CNPJ', document: '11222333000181', legalName: 'Ana Comércio Ltda', tradeName: 'Ana', city: 'Imperatriz', state: 'MA', cityIbgeCode: '2105302', createdAt: '', updatedAt: '' };
const ANDRE = { id: 'p-andre', documentType: 'CPF', document: '52998224725', legalName: 'André Souza', createdAt: '', updatedAt: '' };

type Handler = (config: { url: string; params: Record<string, unknown>; method: string; data: unknown }) => unknown | Promise<unknown>;
let handlers: Array<[RegExp, Handler]> = [];
const calls: Array<{ method: string; url: string; params: Record<string, unknown>; data: unknown }> = [];

describe('pickers', () => {
    const originalAdapter = api.defaults.adapter;

    beforeEach(() => {
        handlers = [];
        calls.length = 0;
        clearResources();
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const entry = { method: String(config.method), url, params: (config.params ?? {}) as Record<string, unknown>, data: config.data ? JSON.parse(String(config.data)) : undefined };
            calls.push(entry);
            const match = handlers.find(([pattern]) => pattern.test(url));
            const data = match ? await match[1](entry) : ok([]);
            return { data, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });

    afterEach(() => {
        api.defaults.adapter = originalAdapter;
    });

    function PersonHarness({ onPick }: { onPick?: (value: PersonSummary | null) => void }) {
        const [value, setValue] = useState<PersonSummary | null>(null);
        return <PersonPicker value={value} onChange={(next) => { setValue(next); onPick?.(next); }} />;
    }

    it('PersonPicker busca por nome, navega com as setas e seleciona com Enter', async () => {
        handlers.push([/^\/persons\/search$/, ({ params }) => ok(String(params.q).toLowerCase().startsWith('an') ? [ANA, ANDRE] : [])]);
        const picked: Array<PersonSummary | null> = [];
        render(<PersonHarness onPick={(value) => picked.push(value)} />);

        await userEvent.type(screen.getByRole('combobox', { name: 'Pessoa' }), 'an');
        const list = await screen.findByRole('listbox', { name: 'Pessoa' });
        expect(within(list).getAllByRole('option')).toHaveLength(2);
        expect(within(list).getByText(/11\.222\.333\/0001-81 · Imperatriz\/MA/)).toBeInTheDocument();
        expect(calls.filter((c) => c.url === '/persons/search')).toHaveLength(1);

        await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}');
        expect(picked.at(-1)).toMatchObject({ id: 'p-ana', legalName: 'Ana Comércio Ltda', document: '11222333000181', city: 'Imperatriz', state: 'MA' });
        expect(screen.getByText('Ana Comércio Ltda (Ana)')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /Trocar/ }));
        expect(picked.at(-1)).toBeNull();
        expect(await screen.findByRole('combobox', { name: 'Pessoa' })).toBeInTheDocument();
    });

    it('PersonPicker descarta a resposta atrasada de uma busca antiga', async () => {
        let releaseOld: () => void = () => undefined;
        handlers.push([
            /^\/persons\/search$/,
            async ({ params }) => {
                if (params.q === 'ma') await new Promise<void>((resolve) => (releaseOld = resolve));
                return ok(params.q === 'ma' ? [ANDRE] : [ANA]);
            },
        ]);
        render(<PersonHarness />);
        const input = screen.getByRole('combobox', { name: 'Pessoa' });
        await userEvent.type(input, 'ma');
        await waitFor(() => expect(calls.some((c) => c.params.q === 'ma')).toBe(true));
        await userEvent.type(input, 'ri');
        expect(await screen.findByRole('option', { name: /Ana Comércio/ })).toBeInTheDocument();

        releaseOld();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(screen.queryByRole('option', { name: /André/ })).not.toBeInTheDocument();
        expect(screen.getByRole('option', { name: /Ana Comércio/ })).toBeInTheDocument();
    });

    it('PersonPicker mostra erro da busca com "Tentar de novo"', async () => {
        let attempt = 0;
        handlers.push([/^\/persons\/search$/, () => {
            attempt += 1;
            if (attempt === 1) throw new Error('falhou');
            return ok([ANA]);
        }]);
        render(<PersonHarness />);
        await userEvent.type(screen.getByRole('combobox', { name: 'Pessoa' }), 'ana');
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
        expect(await screen.findByRole('option', { name: /Ana Comércio/ })).toBeInTheDocument();
    });

    it('PersonPicker sem resultado e com CNPJ válido consulta o CNPJ e cadastra com os campos mínimos', async () => {
        handlers.push(
            [/^\/persons\/search$/, () => ok([])],
            [/^\/accounts\/cnpj\/11222333000181$/, () => ok({ legalName: 'NOVA TRANSPORTES LTDA', tradeName: 'Nova', stateRegistration: '123456', address: { street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Imperatriz', state: 'MA', zipCode: '65900000', cityIbgeCode: '2105302' } })],
            [/^\/persons$/, ({ data }) => ok({ ...(data as object), id: 'p-nova', createdAt: '', updatedAt: '' })],
        );
        const picked: Array<PersonSummary | null> = [];
        render(<PersonHarness onPick={(value) => picked.push(value)} />);

        await userEvent.type(screen.getByRole('combobox', { name: 'Pessoa' }), '11.222.333/0001-81');
        const action = await screen.findByRole('option', { name: /Cadastrar pelo CNPJ 11\.222\.333\/0001-81/ });
        await userEvent.click(within(action).getByRole('button'));

        await waitFor(() => expect(picked.at(-1)?.id).toBe('p-nova'));
        const consult = calls.find((c) => c.url.startsWith('/accounts/cnpj/'));
        expect(consult?.method).toBe('get');
        const created = calls.find((c) => c.url === '/persons' && c.method === 'post');
        expect(created?.data).toEqual({
            documentType: 'CNPJ',
            document: '11222333000181',
            legalName: 'NOVA TRANSPORTES LTDA',
            tradeName: 'Nova',
            cep: '65900000',
            address: 'Rua A',
            number: '10',
            neighborhood: 'Centro',
            city: 'Imperatriz',
            state: 'MA',
            cityIbgeCode: '2105302',
            country: 'BRASIL',
            stateRegistration: '123456',
        });
        expect(picked.at(-1)).toMatchObject({ legalName: 'NOVA TRANSPORTES LTDA', document: '11222333000181' });
    });

    it('PersonPicker não oferece cadastro para CNPJ com dígito verificador errado', async () => {
        handlers.push([/^\/persons\/search$/, () => ok([])]);
        render(<PersonHarness />);
        await userEvent.type(screen.getByRole('combobox', { name: 'Pessoa' }), '11222333000182');
        expect(await screen.findByText(/CNPJ digitado é inválido/)).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /Cadastrar/ })).not.toBeInTheDocument();
    });

    it('buildPersonFromCnpj só leva o endereço quando o município está confirmado', () => {
        const semIbge = buildPersonFromCnpj('11222333000181', { legalName: 'X', address: { city: 'Imperatriz', state: 'MA', zipCode: '65900000' } });
        expect(semIbge).not.toHaveProperty('city');
        expect(semIbge).not.toHaveProperty('cep');
        expect(semIbge.legalName).toBe('X');
    });

    it('CityPicker só aceita cidade da lista com IBGE de 7 dígitos', async () => {
        handlers.push([/^\/locations\/search$/, () => ok([
            { id: 'c1', name: 'Imperatriz', ibgeCode: '2105302', state: { code: 'MA', name: 'Maranhão' } },
            { id: 'c2', name: 'Sem código', ibgeCode: '12', state: { code: 'MA', name: 'Maranhão' } },
        ])]);
        let chosen: CityValue | null = null;
        function Harness() {
            const [value, setValue] = useState<CityValue | null>(null);
            return <CityPicker value={value} onChange={(next) => { chosen = next; setValue(next); }} />;
        }
        render(<Harness />);
        await userEvent.type(screen.getByRole('combobox', { name: 'Cidade' }), 'impe');
        const options = await screen.findAllByRole('option');
        expect(options).toHaveLength(1);
        await userEvent.click(within(options[0]).getByRole('button'));
        expect(chosen).toEqual({ city: 'Imperatriz', state: 'MA', ibgeCode: '2105302' });
        expect(screen.getByText('IBGE 2105302')).toBeInTheDocument();
    });

    it('CepField consulta com 8 dígitos e devolve o endereço', async () => {
        handlers.push([/^\/locations\/cep\/65900000$/, () => ok({ logradouro: 'Rua A', bairro: 'Centro', cidade: 'Imperatriz', uf: 'MA', cityIbgeCode: '2105302' })]);
        const resolved: unknown[] = [];
        function Harness() {
            const [cep, setCep] = useState('');
            return <CepField value={cep} onChange={setCep} onResolve={(address) => resolved.push(address)} />;
        }
        render(<Harness />);
        const input = screen.getByLabelText('CEP');
        await userEvent.type(input, '65900000');
        expect(input).toHaveValue('65900-000');
        await waitFor(() => expect(resolved).toHaveLength(1));
        expect(resolved[0]).toEqual({ cep: '65900000', street: 'Rua A', neighborhood: 'Centro', city: 'Imperatriz', state: 'MA', ibgeCode: '2105302' });
    });

    it('HubSelect lista só hubs ativos e devolve id + item', async () => {
        handlers.push([/^\/hubs$/, () => ok([
            { id: 'h1', name: 'Guarulhos', code: 'SP-GRU', active: true },
            { id: 'h2', name: 'Fechado', code: 'XX', active: false },
        ])]);
        const picks: Array<[string | null, string | undefined]> = [];
        function Harness() {
            const [value, setValue] = useState<string | null>(null);
            return <HubSelect value={value} onChange={(id, hub) => { picks.push([id, hub?.code]); setValue(id); }} />;
        }
        render(<Harness />);
        const select = await screen.findByRole('combobox', { name: 'Hub' });
        await waitFor(() => expect(within(select).getByRole('option', { name: 'Guarulhos (SP-GRU)' })).toBeInTheDocument());
        expect(within(select).queryByRole('option', { name: /Fechado/ })).not.toBeInTheDocument();
        await userEvent.selectOptions(select, 'h1');
        expect(picks.at(-1)).toEqual(['h1', 'SP-GRU']);
    });
});
