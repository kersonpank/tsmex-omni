import { describe, expect, it } from 'vitest';
import type { NfeDistribuicaoMonitorDocumento, OrderInvoiceWithOrder } from '../../../lib/api';
import { cleanCnpjFilter, hasProblem, monitorParams, shortKey, unifyNfeRows } from './sistemaNfe';

const doc = (id: string, createdAt: string): NfeDistribuicaoMonitorDocumento => ({ id, accessKey: 'k'.repeat(44), cnpjEmitente: '11222333000181', tipo: 'NFE_PROC', status: 'DISCOVERED', fiscalEmitter: { displayName: 'X', hub: null }, createdAt });
const invoice = (id: string, createdAt: string) => ({ id, createdAt }) as unknown as OrderInvoiceWithOrder;

describe('unifyNfeRows', () => {
    const docs = [doc('a', '2026-11-01T10:00:00Z'), doc('b', '2026-11-03T10:00:00Z')];
    const manual = [invoice('m', '2026-11-02T10:00:00Z')];
    it('ordena do mais recente ao mais antigo juntando as duas fontes', () => {
        expect(unifyNfeRows(docs, manual, 'ALL').map((r) => r.key)).toEqual(['auto-b', 'manual-m', 'auto-a']);
    });
    it('a origem escolhida limita as fontes', () => {
        expect(unifyNfeRows(docs, manual, 'AUTO').every((r) => r.origin === 'AUTO')).toBe(true);
        expect(unifyNfeRows(docs, manual, 'MANUAL').map((r) => r.key)).toEqual(['manual-m']);
    });
});

describe('filtros', () => {
    it('limpa o CNPJ e corta em 14 dígitos', () => {
        expect(cleanCnpjFilter('11.222.333/0001-81999')).toBe('11222333000181');
    });
    it('não manda filtro vazio', () => {
        expect(monitorParams({ status: '', fiscalEmitterId: '', cnpj: '' })).toEqual({});
        expect(monitorParams({ status: 'FAILED', fiscalEmitterId: 'e1', cnpj: '112' })).toEqual({ status: 'FAILED', fiscalEmitterId: 'e1', cnpjEmitente: '112' });
    });
    it('formata chave e reconhece situações com erro', () => {
        expect(shortKey('12345678901234567890123456789012345678901234')).toBe('…345678901234');
        expect(shortKey(null)).toBe('—');
        expect(hasProblem('FAILED')).toBe(true);
        expect(hasProblem('CONVERTED')).toBe(false);
    });
});
