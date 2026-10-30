import { describe, expect, it } from 'vitest';
import type { CollectionRequest } from '../../../types/index';
import { EMPTY_ADDRESS } from '../ui/AddressFields';
import {
    AVERBACAO_NOTE,
    addressLine,
    buildWhatsappSummary,
    canRequestCollection,
    collectionBadge,
    collectionFormError,
    dedupeAddresses,
    formatGoogleMapsUrl,
    formatPhoneTelUrl,
    formatWhatsappContactUrl,
    invalidKeyChunks,
    parseNfKeys,
    shortDate,
    todayIso,
} from './collection';

const K1 = '1'.repeat(44);
const K2 = '2'.repeat(44);
const addr = { ...EMPTY_ADDRESS, cep: '65900000', address: 'Rua A', number: '10', city: 'Imperatriz', state: 'MA', cityIbgeCode: '2105302' };
const base = { senderId: 'p1', address: addr, requestedDate: '2026-11-05', weightKg: '', units: '', keysText: '' };

describe('coleta solicitada — helpers', () => {
    it('parseNfKeys separa várias chaves, remove duplicadas e ignora lixo', () => {
        expect(parseNfKeys(`${K1}\n${K2}, ${K1} 123`)).toEqual([K1, K2]);
        expect(parseNfKeys('')).toEqual([]);
    });

    it('invalidKeyChunks aponta pedaços que não são chave', () => {
        expect(invalidKeyChunks(`${K1} 123`)).toEqual(['123']);
        expect(invalidKeyChunks(K1)).toEqual([]);
    });

    it('datas de calendário sem deslocar fuso', () => {
        expect(shortDate('2026-11-05')).toBe('05/11');
        expect(todayIso(new Date(2026, 0, 9))).toBe('2026-01-09');
        expect(collectionBadge({ requestedDate: '2026-11-05' })).toBe('Coleta solicitada · 05/11');
        expect(collectionBadge({ requestedDate: '' })).toBe('Coleta solicitada');
    });

    it('addressLine monta a linha legível', () => {
        expect(addressLine(addr)).toBe('Rua A, 10 - Imperatriz/MA');
    });

    it('validação do formulário', () => {
        expect(collectionFormError(base, '2026-11-01')).toBeNull();
        expect(collectionFormError({ ...base, senderId: null })).toMatch(/remetente/i);
        expect(collectionFormError({ ...base, address: EMPTY_ADDRESS })).toMatch(/endereço/i);
        expect(collectionFormError({ ...base, requestedDate: '2026-10-01' }, '2026-11-01')).toMatch(/passado/);
        expect(collectionFormError({ ...base, weightKg: 'abc' }, '2026-11-01')).toMatch(/Peso/);
        expect(collectionFormError({ ...base, units: '1.5' }, '2026-11-01')).toMatch(/Volumes/);
        expect(collectionFormError({ ...base, keysText: '123' }, '2026-11-01')).toMatch(/44/);
    });
});

describe('canRequestCollection', () => {
    const awaiting = { kind: 'intake', bucket: 'awaiting', demandId: 'd1', collectionRequest: null, allowedActions: { confirmArrival: true } } as never;
    it('só NF aguardando, sem coleta e com permissão de receber', () => {
        expect(canRequestCollection(awaiting)).toBe(true);
        expect(canRequestCollection({ ...(awaiting as object), collectionRequest: { requestedDate: 'x' } } as never)).toBe(false);
        expect(canRequestCollection({ ...(awaiting as object), allowedActions: { confirmArrival: false } } as never)).toBe(false);
        expect(canRequestCollection({ ...(awaiting as object), kind: 'order' } as never)).toBe(false);
    });
});

describe('novos helpers de coleta (W9)', () => {
    it('formatGoogleMapsUrl monta link válido de busca', () => {
        expect(formatGoogleMapsUrl(addr)).toContain('https://www.google.com/maps/search/?api=1&query=');
        expect(formatGoogleMapsUrl(addr)).toContain('Imperatriz');
        expect(formatGoogleMapsUrl(null)).toBe('https://www.google.com/maps');
    });

    it('formatWhatsappContactUrl e formatPhoneTelUrl normalizam números brasileiros', () => {
        expect(formatWhatsappContactUrl('99 98888-7777')).toBe('https://wa.me/5599988887777');
        expect(formatWhatsappContactUrl('+55 11 91234-5678')).toBe('https://wa.me/5511912345678');
        expect(formatWhatsappContactUrl('')).toBeNull();
        expect(formatWhatsappContactUrl(null)).toBeNull();

        expect(formatPhoneTelUrl('99 98888-7777')).toBe('tel:+5599988887777');
        expect(formatPhoneTelUrl('+55 (11) 91234-5678')).toBe('tel:+5511912345678');
    });

    it('dedupeAddresses remove endereços idênticos preservando os únicos', () => {
        const a1 = { city: 'Imperatriz', state: 'MA', address: 'Rua A', number: '10' };
        const a2 = { city: 'Imperatriz', state: 'MA', address: 'Rua A', number: '10' };
        const a3 = { city: 'Açailândia', state: 'MA', address: 'Av B', number: '20' };
        expect(dedupeAddresses([a1, a2, a3])).toHaveLength(2);
        expect(dedupeAddresses([])).toEqual([]);
    });

    it('buildWhatsappSummary gera texto completo com o modelo da empresa', () => {
        const sample: CollectionRequest = {
            senderPersonId: 'p1',
            senderName: 'Distribuidora Alfa',
            contractingPersonName: 'Cliente Beta',
            contacts: [
                { name: 'Marcos', phone: '(99) 98888-1111', role: 'Expedição', email: 'marcos@alfa.com' },
            ],
            availabilityWindow: '08:00–12:00',
            address: {
                address: 'Av Industrial',
                number: '500',
                neighborhood: 'Distrito',
                city: 'Imperatriz',
                state: 'MA',
                cep: '65900-000',
                referencePoint: 'Portão 2',
                accessInstructions: 'Doca 4 livre para carretas',
            },
            goodsDescription: 'Filtros e óleos industriais',
            approxUnits: 10,
            approxWeightKg: 450.5,
            nfValue: 18000,
            packageDimensions: [{ quantity: 10, lengthCm: 40, widthCm: 30, heightCm: 30, weightKg: 45 }],
            needsHelper: true,
            needsLoading: true,
            requestedDate: '2026-11-05',
            windowLabel: 'Manhã',
            nfKeys: [K1],
            note: 'Carga frágil',
            requestedAt: '2026-10-30T10:00:00Z',
        };

        const text = buildWhatsappSummary(sample);
        expect(text).toContain('SOLICITAÇÃO DE COLETA');
        expect(text).toContain('Cliente Beta');
        expect(text).toContain('Distribuidora Alfa');
        expect(text).toContain('Av Industrial, 500');
        expect(text).toContain('Portão 2');
        expect(text).toContain('Doca 4 livre para carretas');
        expect(text).toContain('Marcos (Expedição) - Tel: (99) 98888-1111');
        expect(text).toContain('Horário disponível: 08:00–12:00');
        expect(text).toContain('Filtros e óleos industriais');
        expect(text).toContain('10 vol.');
        expect(text).toContain('450.5 kg');
        expect(text).toContain('10x 40x30x30 cm');
        expect(text).toContain('Precisa de ajudante: Sim');
        expect(text).toContain('Necessário carregar pela equipe: Sim');
        expect(text).toContain('Carga frágil');
        expect(text).toContain(AVERBACAO_NOTE);
    });
});
