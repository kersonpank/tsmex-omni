import { describe, expect, it } from 'vitest';
import { demandStatusLabel, groupOpportunities, parseQuotePrice, quoteViewStatus } from './comercial';

describe('parseQuotePrice', () => {
    it('recusa vazio, zero, negativo e texto', () => {
        for (const raw of ['', '  ', '0', '-5', 'abc']) expect(parseQuotePrice(raw).ok).toBe(false);
    });
    it('aceita ponto e vírgula decimal', () => {
        expect(parseQuotePrice('150.5')).toEqual({ ok: true, value: 150.5 });
        expect(parseQuotePrice('1.234,56')).toEqual({ ok: true, value: 1234.56 });
    });
});

describe('rótulos', () => {
    it('traduz status e nunca devolve o enum', () => {
        expect(demandStatusLabel('PENDING')).toBe('Aguardando cotação');
        expect(demandStatusLabel('QUOTED')).toBe('Cotada');
        expect(demandStatusLabel('XYZ')).not.toContain('XYZ');
    });
    it('Todas não manda status', () => {
        expect(quoteViewStatus('ALL')).toBeUndefined();
        expect(quoteViewStatus('PENDING')).toBe('PENDING');
    });
});

describe('groupOpportunities', () => {
    it('conta por estágio na ordem do funil e soma só o que tem valor', () => {
        const result = groupOpportunities([
            { stage: 'QUOTE', quotedPrice: 100 },
            { stage: 'QUOTE', quotedPrice: 50 },
            { stage: 'LOST' },
            { stage: 'FOLLOW_UP' },
        ]);
        expect(result.map((g) => g.stage)).toEqual(['QUOTE', 'FOLLOW_UP', 'COLLECTION_REQUESTED', 'CONVERTED', 'LOST']);
        expect(result[0]).toMatchObject({ count: 2, value: 150, label: 'Cotação' });
        expect(result[1]).toMatchObject({ count: 1, value: null });
        expect(result[2].count).toBe(0);
    });
    it('estágio desconhecido vai ao fim', () => {
        const result = groupOpportunities([{ stage: 'NOVO' as never }]);
        expect(result[result.length - 1]).toMatchObject({ stage: 'NOVO', count: 1 });
    });
});
