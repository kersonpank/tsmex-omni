import { describe, expect, it } from 'vitest';
import { blockerAction, documentStatusView, EMPTY_INFORMED, parseInformed, payerFromModFrete, pricingSourceLabel, readyToEmit } from './freight';

describe('payerFromModFrete', () => {
    it('0 = remetente (CIF), 1 = destinatário (FOB); o resto pergunta', () => {
        expect(payerFromModFrete('0')).toBe('CIF');
        expect(payerFromModFrete(1)).toBe('FOB');
        expect(payerFromModFrete('2')).toBeNull();
        expect(payerFromModFrete(undefined)).toBeNull();
    });
});

describe('documentStatusView', () => {
    it('autorizado, enviando, rejeitado com motivo', () => {
        expect(documentStatusView({ documentType: 'CTE', status: 'CTE_AUTHORIZED', number: '12', statusReason: null })).toEqual({
            tone: 'ok',
            label: 'CT-e nº 12 autorizado',
        });
        expect(documentStatusView({ documentType: 'CTE', status: 'CTE_PROCESSING', number: '12', statusReason: null }).tone).toBe('route');
        expect(documentStatusView({ documentType: 'CTE', status: 'CTE_REJECTED', number: null, statusReason: 'IE inválida' }).label).toBe(
            'CT-e rejeitado: IE inválida',
        );
        expect(documentStatusView({ documentType: 'MINUTA', status: 'MINUTA_EMITTED', number: '5', statusReason: null }).label).toBe('Minuta nº 5 emitida');
    });
});

describe('pendências e prontidão', () => {
    it('pendência aponta quem resolve', () => {
        expect(blockerAction('Remetente precisa de endereço, município, UF e CEP.', 'remetente')).toBe('remetente');
        expect(blockerAction('Tomador (CNPJ) precisa de Inscrição Estadual', 'destinatario')).toBe('destinatario');
        expect(blockerAction('Hub emissor precisa de RNTRC para CT-e.', 'remetente')).toBe('tower');
    });

    it('frete informado soma os campos na escrita brasileira', () => {
        expect(parseInformed({ ...EMPTY_INFORMED, freightBase: '1.200,50', toll: '30' })).toEqual({
            values: { freightBase: 1200.5, toll: 30 },
            total: 1230.5,
        });
    });

    it('pronto = sem pendência e com preço de tabela', () => {
        expect(readyToEmit({ blockers: [], preview: { total: 10, breakdown: {} as never, effectiveWeight: 1 } })).toBe(true);
        expect(readyToEmit({ blockers: [], preview: null })).toBe(false);
        expect(pricingSourceLabel(null)).toMatch(/informe/);
    });
});
