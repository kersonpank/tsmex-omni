import { describe, expect, it } from 'vitest';
import type { Hub } from '../../../types/index';
import {
    buildHubPayload, coveragePayload, EMPTY_HUB_FORM, EMPTY_PERSON_FORM, emitterRemovalBlocked, hubInviteUrl, matchesClient, matchesHub, paginate,
    permissionsLabel, personErrors, personListParams, validateCoverage,
} from './redeCadastro';

const hub = { id: 'h1', name: 'Guarulhos', code: 'SP-GRU', city: 'Guarulhos', state: 'SP', active: true, personId: 'p1', coverageCities: [], canOrchestrate: false } as Hub;

describe('redeCadastro', () => {
    it('payload do hub: vazio não vira null onde o servidor recusa', () => {
        const create = buildHubPayload({ ...EMPTY_HUB_FORM, name: ' A ', code: 'x', city: 'Imperatriz', state: 'ma', cityIbgeCode: '2105302' }, false);
        expect(create).toMatchObject({ name: 'A', state: 'MA', address: undefined, email: undefined, gatewayHubId: null });
        expect(create.personId).toBeUndefined();
        expect(buildHubPayload({ ...EMPTY_HUB_FORM, address: '' }, true).address).toBe('');
    });

    it('não deixa remover o CNPJ emissor (servidor não aceita nulo)', () => {
        expect(emitterRemovalBlocked(hub, { ...EMPTY_HUB_FORM, personId: null })).toBe(true);
        expect(emitterRemovalBlocked(hub, { ...EMPTY_HUB_FORM, personId: 'p2' })).toBe(false);
        expect(emitterRemovalBlocked(null, EMPTY_HUB_FORM)).toBe(false);
    });

    it('filtra hubs por texto e situação', () => {
        expect(matchesHub(hub, 'gru', 'active')).toBe(true);
        expect(matchesHub(hub, '', 'inactive')).toBe(false);
        expect(matchesHub({ ...hub, active: false }, 'imperatriz', 'all')).toBe(false);
    });

    it('link de convite e rótulo de permissões', () => {
        expect(hubInviteUrl('http://x', '/', 'h1', 'a b')).toBe('http://x/#/hub/cadastro?hubId=h1&token=a%20b');
        expect(permissionsLabel(['entrada', 'manifestos'])).toBe('Entrada, Viagens');
        expect(permissionsLabel([])).toBe('Sem permissões');
    });

    it('cobertura: repetida, prioridade e prazo fora da faixa', () => {
        const row = { cityIbgeCode: '2105302', cityName: 'Imperatriz', state: 'MA', leadTimeDays: 2, priority: 100, active: true };
        expect(validateCoverage([row])).toBeNull();
        expect(validateCoverage([row, row])).toMatch(/repetida/);
        expect(validateCoverage([{ ...row, priority: 0 }])).toMatch(/Prioridade/);
        expect(validateCoverage([{ ...row, leadTimeDays: 61 }])).toMatch(/Prazo/);
        expect(coveragePayload([{ ...row, leadTimeDays: null, active: false }])).toEqual([{ cityIbgeCode: '2105302', priority: 100, active: false }]);
    });

    it('pessoa: documento, cidade confirmada, IE de emissor e RNTRC', () => {
        const base = { ...EMPTY_PERSON_FORM, legalName: 'X', document: '11222333000181' };
        expect(personErrors(base, false)).toEqual({});
        expect(personErrors({ ...base, document: '11222333000180' }, false).document).toMatch(/inválido/);
        expect(personErrors({ ...base, city: 'Imperatriz' }, false).city).toMatch(/Confirme/);
        expect(personErrors(base, true).stateRegistration).toMatch(/Emissor/);
        expect(personErrors({ ...base, stateRegistration: 'isento' }, true)).toEqual({});
        expect(personErrors({ ...base, rntrc: '123' }, false).rntrc).toMatch(/8 ou 9/);
    });

    it('busca de pessoas: número vira documento, texto vira nome', () => {
        expect(personListParams({ type: '', client: '', link: '', text: '11.222.333' })).toEqual({ document: '11222333' });
        expect(personListParams({ type: 'CPF', client: 'false', link: 'true', text: 'Ana' })).toEqual({ documentType: 'CPF', name: 'Ana', hasClient: false, hasLink: true });
    });

    it('paginação e busca de cliente', () => {
        expect(paginate([1, 2, 3, 4, 5], 9, 2)).toEqual({ rows: [5], pages: 3, page: 3 });
        const client = { id: 'c', companyName: 'Comercial Tocantins', document: '11222333000181', contactName: 'Ana', phone: '1', user: { email: 'a@b.com' } } as never;
        expect(matchesClient(client, '11.222')).toBe(true);
        expect(matchesClient(client, 'a@b')).toBe(true);
        expect(matchesClient(client, 'zzz')).toBe(false);
    });
});
