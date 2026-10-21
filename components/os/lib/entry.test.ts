import { describe, expect, it } from 'vitest';
import {
    classifyPartyQuery,
    entryMissing,
    formatDocument,
    missingSentence,
    parseCargoForm,
    partyGaps,
    xmlCargoSummary,
} from './entry';

describe('classifyPartyQuery', () => {
    it('reconhece CNPJ e CPF com ou sem máscara', () => {
        expect(classifyPartyQuery('11.222.333/0001-81')).toEqual({ kind: 'cnpj', digits: '11222333000181' });
        expect(classifyPartyQuery('11222333000181')).toEqual({ kind: 'cnpj', digits: '11222333000181' });
        expect(classifyPartyQuery('123.456.789-09')).toEqual({ kind: 'cpf', digits: '12345678909' });
    });

    it('texto com letras é nome, mesmo contendo números', () => {
        expect(classifyPartyQuery('  Loja 12 ')).toEqual({ kind: 'name', text: 'Loja 12' });
        expect(classifyPartyQuery('1122')).toEqual({ kind: 'name', text: '1122' });
        expect(classifyPartyQuery('   ')).toEqual({ kind: 'empty' });
    });
});

describe('formatDocument', () => {
    it('aplica a máscara de CNPJ/CPF e preserva o resto', () => {
        expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
        expect(formatDocument('12345678909')).toBe('123.456.789-09');
        expect(formatDocument('ABC')).toBe('ABC');
    });
});

describe('parseCargoForm', () => {
    it('aceita a escrita brasileira de peso e valor', () => {
        expect(parseCargoForm({ units: '3', weight: '1.250,5', value: '4.500,00' })).toEqual({
            cargo: { units: 3, weightKg: 1250.5, nfValue: 4500 },
            missing: [],
        });
    });

    it('lista o que falta, sem aceitar zero', () => {
        expect(parseCargoForm({ units: '0', weight: '', value: '10' })).toEqual({ cargo: null, missing: ['volumes', 'peso'] });
    });
});

describe('xmlCargoSummary', () => {
    it('usa peso bruto e cai para o líquido', () => {
        expect(xmlCargoSummary({ quantidadeVolumes: 2, pesoLiquido: 30, valorTotalNota: 99 })).toEqual({ units: 2, weightKg: 30, nfValue: 99 });
        expect(xmlCargoSummary(null)).toBeNull();
    });
});

describe('entryMissing / missingSentence', () => {
    it('diz em uma frase o que falta para confirmar', () => {
        const missing = entryMissing({ hasRemetente: true, hasDestinatario: false, cargoMissing: ['peso'] });
        expect(missing).toEqual(['destinatário', 'peso']);
        expect(missingSentence(missing)).toBe('Falta: destinatário e peso.');
        expect(missingSentence(['remetente', 'destinatário', 'peso'])).toBe('Falta: remetente, destinatário e peso.');
        expect(missingSentence([])).toBeNull();
        expect(entryMissing({ hasRemetente: true, hasDestinatario: true, hasPayer: false, cargoMissing: [] })).toEqual(['quem paga o frete']);
    });
});

describe('partyGaps', () => {
    it('aponta cidade sem IBGE e CNPJ sem IE; CPF não exige IE', () => {
        expect(partyGaps({ documentType: 'CNPJ', city: 'Guarabira', cityIbgeCode: '2506301', stateRegistration: 'ISENTO' })).toEqual([]);
        expect(partyGaps({ documentType: 'CNPJ', city: 'Guarabira', cityIbgeCode: null })).toEqual(['cidade', 'IE']);
        expect(partyGaps({ documentType: 'CPF', city: 'Guarabira', cityIbgeCode: '2506301' })).toEqual([]);
    });
});
