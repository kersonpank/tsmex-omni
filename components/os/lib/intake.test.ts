import { describe, expect, it } from 'vitest';
import type { HubCargoItem, HubCargoResolution } from '../../../types/index';
import { looksLikeAccessKey, nextScanStep } from './intake';

const item = { id: 'i1', kind: 'intake', bucket: 'awaiting', status: 'X', statusLabel: 'X', invoiceCount: 1 } as unknown as HubCargoItem;
const KEY = '2'.repeat(44);

describe('nextScanStep — a chave da NF-e sempre leva à entrada', () => {
    it('nota esperada → confirmar entrada', () => {
        expect(nextScanStep({ resolution: 'awaiting_arrival', item })).toEqual({ kind: 'entry', item });
    });

    it('nota baixada da SEFAZ (triagem) → preparar a entrada', () => {
        const res = { resolution: 'fiscal_document_found', item: { ...item, fiscalDocumentId: 'fd1' }, accessKey: KEY } as HubCargoResolution;
        expect(nextScanStep(res)).toEqual({ kind: 'convert_fiscal', fiscalDocumentId: 'fd1', accessKey: KEY });
    });

    it('nota válida sem cadastro → criar a entrada pela chave', () => {
        const res: HubCargoResolution = { resolution: 'valid_nfe_not_registered', accessKey: KEY, cnpjEmit: '1', message: 'x' };
        expect(nextScanStep(res)).toEqual({ kind: 'create_from_key', accessKey: KEY, cnpjEmit: '1' });
    });

    it('pedido em viagem para cá abre com orientação, nunca silencioso', () => {
        const step = nextScanStep({ resolution: 'order_incoming', item });
        expect(step.kind).toBe('item');
        expect(step.kind === 'item' && step.note).toContain('Receber');
    });

    it('código inválido devolve a mensagem do servidor', () => {
        expect(nextScanStep({ resolution: 'invalid', message: 'Inválido.', preservedCode: 'x' })).toEqual({ kind: 'error', message: 'Inválido.' });
    });
});

describe('looksLikeAccessKey', () => {
    it('44 dígitos com ou sem separadores', () => {
        expect(looksLikeAccessKey(KEY)).toBe(true);
        expect(looksLikeAccessKey('3526 1012 3456 7800 0190 5500 1000 0012 3410 0012 3456')).toBe(true);
        expect(looksLikeAccessKey('1234')).toBe(false);
    });
});
