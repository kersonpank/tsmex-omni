import { describe, expect, it } from 'vitest';
import { describeTripClosing, formatBRL } from './tripClosing';

const complete = {
  revenueNet: 1800, linkCost: 1000, hubCost: 180, margin: 620, marginPercent: 34.44,
  costComplete: true, revenueEstimated: false, ordersWithoutOfficialFreight: 0, ordersWithoutFreightValue: 0,
  occupancyWeightPercent: 50, occupancyVolumePercent: 25, linkCostSource: 'CARTA_FRETE' as const,
};

describe('formatBRL', () => {
  it('sempre 2 casas', () => {
    expect(formatBRL(1234.5)).toMatch(/1\.234,50/);
    expect(formatBRL(0)).toMatch(/0,00/);
    expect(formatBRL(null)).toBe('—');
  });
});

describe('describeTripClosing', () => {
  it('dado completo: sem avisos, margem e ocupação formatadas', () => {
    const d = describeTripClosing(complete);
    expect(d.warnings).toEqual([]);
    expect(d.margin).toMatch(/620,00/);
    expect(d.marginPercent).toBe('34,4%');
    expect(d.occupancyWeight).toBe('50%');
    expect(d.occupancyVolume).toBe('25%');
    expect(d.tone).toBe('good');
  });

  it('margem negativa fica em tom de prejuízo', () => {
    expect(describeTripClosing({ ...complete, margin: -50, marginPercent: -2.5 }).tone).toBe('bad');
  });

  it('custo do transportador ausente: explica em linguagem simples e não mostra margem inventada', () => {
    const d = describeTripClosing({ ...complete, costComplete: false, linkCost: null, margin: null, marginPercent: null });
    expect(d.margin).toBe('—');
    expect(d.linkCost).toBe('não lançado');
    expect(d.warnings.join(' ')).toMatch(/Carta Frete/);
    expect(d.warnings.join(' ')).toMatch(/acordo/);
    expect(d.tone).toBe('incomplete');
  });

  it('receita estimada: diz quantos pedidos ainda não têm documento emitido', () => {
    const d = describeTripClosing({ ...complete, revenueEstimated: true, ordersWithoutOfficialFreight: 2 });
    expect(d.warnings.join(' ')).toMatch(/2 pedidos sem CT-e, DC-e ou minuta emitido/);
    expect(d.tone).toBe('incomplete');
  });

  it('singular e pedido sem valor de frete', () => {
    const d = describeTripClosing({ ...complete, revenueEstimated: true, ordersWithoutOfficialFreight: 1, ordersWithoutFreightValue: 1 });
    expect(d.warnings.join(' ')).toMatch(/1 pedido sem CT-e/);
    expect(d.warnings.join(' ')).toMatch(/1 pedido sem valor de frete/);
  });

  it('sem capacidade cadastrada: ocupação indisponível', () => {
    const d = describeTripClosing({ ...complete, occupancyWeightPercent: null, occupancyVolumePercent: null });
    expect(d.occupancyWeight).toBe('—');
  });
});
