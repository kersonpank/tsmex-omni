import { describe, expect, it } from 'vitest';
import {
    applyLookupToDraft,
    buildEntradaPayload,
    buildInvoicePayload,
    buildPeoplePayload,
    coletaFromCollectionData,
    coletaToCollectionData,
    draftFromInvoice,
    emptyColeta,
    invoicePendencies,
    invoiceTotals,
    newInvoiceDraft,
    parsePlaceText,
    payerLockReason,
    payerOf,
    validateColeta,
    validateInvoice,
    validateParties,
    type PartiesDraft,
} from './pedidoForm';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';
const SP = { city: 'Guarulhos', state: 'SP', ibgeCode: '3518800' };
const MA = { city: 'Imperatriz', state: 'MA', ibgeCode: '' };

const parties = (patch: Partial<PartiesDraft> = {}): PartiesDraft => ({
    hubId: null, freightTerm: 'CIF', remetente: { id: UUID }, destinatario: { id: UUID2 }, consignatario: null, expedidor: null, redespachante: null, origem: SP, fim: MA, routeId: null, ...patch,
});

describe('pedidoForm: pessoas', () => {
    it('quem paga segue o frete', () => {
        const p = { remetente: { id: 'r' }, destinatario: { id: 'd' }, consignatario: { id: 'c' } };
        expect(payerOf('CIF', p)?.id).toBe('r');
        expect(payerOf('FOB', p)?.id).toBe('d');
        expect(payerOf('REDESPACHO', p)?.id).toBe('c');
        expect(payerOf('REDESPACHO', { ...p, consignatario: null })?.id).toBe('d');
        expect(payerOf(null, p)).toBeNull();
    });

    it('valida os mesmos obrigatórios da clássica', () => {
        expect(Object.keys(validateParties({ ...parties(), freightTerm: null, remetente: null, destinatario: null, origem: null, fim: null })).sort()).toEqual(['destinatario', 'fim', 'freightTerm', 'origem', 'remetente']);
        expect(validateParties(parties({ freightTerm: 'REDESPACHO' })).consignatario).toMatch(/consignatário/);
        expect(validateParties(parties())).toEqual({});
    });

    it('lê "Cidade, UF" e ignora o marcador da varredura', () => {
        expect(parsePlaceText('Imperatriz, MA', '2105302')).toEqual({ city: 'Imperatriz', state: 'MA', ibgeCode: '2105302' });
        expect(parsePlaceText('A definir')).toBeNull();
        expect(parsePlaceText('Imperatriz')).toBeNull();
    });

    it('monta o corpo de entrada sem UUID vazio e com a chave da NF', () => {
        const payload = buildEntradaPayload(parties({ hubId: UUID, consignatario: { id: '' }, expedidor: { id: 'lixo' } }), { isHub: false, documentKey: '1'.repeat(44) });
        expect(payload).toEqual({
            freightTerm: 'CIF', remetentePersonId: UUID, destinatarioPersonId: UUID2,
            origemPrestacao: 'Guarulhos, SP', origemIbgeCode: '3518800', fimPrestacao: 'Imperatriz, MA', fimIbgeCode: undefined,
            hubId: UUID, documentKey: '1'.repeat(44),
        });
        expect(buildEntradaPayload(parties({ hubId: UUID }), { isHub: true, userHubId: UUID2 }).hubId).toBe(UUID2);
    });

    it('monta o corpo de edição esvaziando opcionais com null', () => {
        expect(buildPeoplePayload(parties())).toMatchObject({ consignatarioPersonId: null, expedidorPersonId: null, redespachantePersonId: null, routeId: null, origemIbgeCode: '3518800', fimIbgeCode: null });
        expect(buildPeoplePayload(parties(), { a: 1 })).toHaveProperty('collectionData', { a: 1 });
    });

    it('trava o pagador com fatura ou documento fiscal', () => {
        expect(payerLockReason({})).toBeNull();
        expect(payerLockReason({ invoices: [{ status: 'OPEN' }] })).toMatch(/faturado/);
        expect(payerLockReason({ invoices: [{ status: 'CANCELLED' }] })).toBeNull();
        expect(payerLockReason({ freightCalculations: [{ status: 'CTE_AUTHORIZED', documentType: 'CTE', cteNumber: '88' }] })).toMatch(/CT-e nº 88/);
        expect(payerLockReason({ freightCalculations: [{ status: 'MINUTA_EMITTED', documentType: 'MINUTA' }] })).toBeNull();
        expect(payerLockReason({ freightCalculations: [{ status: 'CTE_REJECTED', documentType: 'CTE' }] })).toBeNull();
    });
});

describe('pedidoForm: notas', () => {
    const nfe = () => ({ ...newInvoiceDraft('NFE'), nfNumber: '5521', weight: 120.5, value: 900, rows: [{ qty: 3, alturaCm: '10', larguraCm: '20', comprimentoCm: '30' }] });

    it('NF-e exige número ou chave e cubagem (medidas ou m³)', () => {
        const empty = newInvoiceDraft('NFE');
        expect(validateInvoice(empty)).toMatchObject({ nfNumber: expect.any(String), cubage: expect.any(String) });
        expect(validateInvoice(nfe())).toEqual({});
        expect(validateInvoice({ ...empty, nfNumber: '1', cubedManual: 0.5 })).toEqual({});
        expect(validateInvoice({ ...nfe(), nfKey: '123' }).nfKey).toMatch(/44/);
        expect(validateInvoice({ ...nfe(), emissionDate: '45/13/2026' }).emissionDate).toBeTruthy();
    });

    it('declaração exige descrição e não pede cubagem', () => {
        expect(validateInvoice(newInvoiceDraft('OUTRAS')).nature).toMatch(/descrição/);
        expect(validateInvoice({ ...newInvoiceDraft('OUTRAS'), nature: 'Roupas' })).toEqual({});
    });

    it('monta o corpo da nota como a clássica', () => {
        expect(buildInvoicePayload({ ...nfe(), emissionDate: '13/11/2026', species: 'Volumes' })).toEqual({
            type: 'NFE', nfNumber: '5521', nfKey: undefined, emissionDate: '2026-11-13T12:00:00', nature: undefined, species: 'Volumes',
            volumes: 3, weight: 120.5, cubedVolume: 0.018, value: 900,
        });
        expect(buildInvoicePayload({ ...newInvoiceDraft('OUTRAS'), nature: 'Roupas' }, 99).nfNumber).toBe('DC-99');
        expect(buildInvoicePayload({ ...newInvoiceDraft('NFE'), nfKey: `${'0'.repeat(36)}12345678`, cubedManual: 1 }).nfNumber).toBe('12345678');
    });

    it('reabre nota gravada com volume e cubagem manual', () => {
        const draft = draftFromInvoice({ id: 'i1', type: 'NFE', nfNumber: '9', volumes: 4.2, weight: 10, cubedVolume: 0.3, value: 50, emissionDate: '2026-11-13T12:00:00' });
        expect(draft).toMatchObject({ id: 'i1', cubedManual: 0.3, rows: [{ qty: 4 }] });
        expect(validateInvoice(draft)).toEqual({});
    });

    it('soma totais e lista pendências', () => {
        const a = nfe();
        const b = { ...newInvoiceDraft('NFE'), nfNumber: '77', weight: 5, value: 10 };
        expect(invoiceTotals([a, b])).toMatchObject({ count: 2, volumes: 4, weight: 125.5, value: 910 });
        expect(invoicePendencies([a, b])).toEqual(['NF 5521: espécie', 'NF 77: cubagem e espécie']);
    });

    it('aplica a consulta da NF-e sem sobrescrever o que já foi digitado', () => {
        const filled = applyLookupToDraft(newInvoiceDraft('NFE'), { chave: '9'.repeat(44), numero: '321', emissionDate: '2026-10-01' });
        expect(filled).toMatchObject({ nfKey: '9'.repeat(44), nfNumber: '321', emissionDate: '01/10/2026', fromLookup: true });
        expect(applyLookupToDraft({ ...filled, nfNumber: '999' }, { chave: '9'.repeat(44), numero: '321' }).nfNumber).toBe('999');
    });
});

describe('pedidoForm: coleta', () => {
    const coleta = () => ({
        ...emptyColeta(), street: 'Rua A', number: '10', neighborhood: 'Centro', cep: '65900000', city: 'Imperatriz', state: 'MA',
        contacts: [{ name: 'Rita', phone: '99988887777', email: '' }], rows: [{ qty: 2, alturaCm: '10', larguraCm: '10', comprimentoCm: '10' }], weight: 30,
    });

    it('valida endereço, contato e medidas', () => {
        expect(Object.keys(validateColeta(emptyColeta())).sort()).toEqual(['address', 'contacts', 'rows']);
        expect(validateColeta(coleta())).toEqual({});
    });

    it('vai e volta pelo collectionData', () => {
        const data = coletaToCollectionData(coleta());
        expect(data).toMatchObject({ volumes: 2, weight: 30, address: { street: 'Rua A', cep: '65900000' }, senderContacts: [{ name: 'Rita', phone: '99988887777' }] });
        expect(JSON.parse(String(data.dimensions))).toEqual([{ qty: 2, altura: 10, largura: 10, comprimento: 10 }]);
        const back = coletaFromCollectionData(data);
        expect(back).toMatchObject({ street: 'Rua A', weight: 30, rows: [{ qty: 2, alturaCm: '10' }] });
    });
});
