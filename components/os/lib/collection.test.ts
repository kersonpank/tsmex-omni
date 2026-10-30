import { describe, expect, it } from 'vitest';
import { EMPTY_ADDRESS } from '../ui/AddressFields';
import { addressLine, canRequestCollection, collectionBadge, collectionFormError, invalidKeyChunks, parseNfKeys, shortDate, todayIso } from './collection';

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
