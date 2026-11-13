import { describe, expect, it } from 'vitest';
import type { Manifest, ManifestFiscalDocument } from '../../../types/index';
import { countTripsByFilter, marginView, matchesTripFilter, matchesTripQuery, parseTripFilter, tripMilestones } from './viagens';

const doc = (over: Partial<ManifestFiscalDocument>): ManifestFiscalDocument =>
    ({ id: 'd', manifestId: 'm', documentType: 'MDFE', status: 'AUTHORIZED', createdAt: '', updatedAt: '', ...over }) as ManifestFiscalDocument;

const trip = (over: Partial<Manifest>): Manifest =>
    ({
        id: 'abcdef12-0000-0000-0000-000000000000',
        origin: 'Fortaleza, CE',
        destination: 'Recife, PE',
        originCity: 'Fortaleza',
        destinationCity: 'Recife',
        status: 'DRAFT',
        totalWeight: 0,
        totalVolume: 0,
        totalValue: 0,
        vehicleTypeId: 'v',
        createdAt: '2026-11-01T10:00:00Z',
        updatedAt: '2026-11-01T10:00:00Z',
        ...over,
    }) as Manifest;

const NOW = new Date('2026-11-13T12:00:00Z');

describe('filtros de viagem', () => {
    const blocked = trip({ id: 'b', status: 'COMPLETED', fiscalDocuments: [doc({})] });
    const road = trip({ id: 'r', status: 'IN_PROGRESS' });
    const offered = trip({ id: 'o', status: 'PENDING_ACCEPT' });
    const done = trip({ id: 'd', status: 'COMPLETED', fiscalDocuments: [doc({ status: 'CLOSED' })] });
    const all = [blocked, road, offered, done];

    it('classifica travada, atenção, estrada, preparando e concluída', () => {
        expect(matchesTripFilter(blocked, 'blocked', NOW)).toBe(true);
        expect(matchesTripFilter(offered, 'attention', NOW)).toBe(true);
        expect(matchesTripFilter(road, 'road', NOW)).toBe(true);
        expect(matchesTripFilter(offered, 'preparing', NOW)).toBe(true);
        expect(matchesTripFilter(done, 'done', NOW)).toBe(true);
        expect(matchesTripFilter(done, 'blocked', NOW)).toBe(false);
    });

    it('conta por filtro', () => {
        expect(countTripsByFilter(all, NOW)).toEqual({ all: 4, blocked: 1, attention: 1, road: 1, preparing: 1, done: 2 });
    });

    it('filtro desconhecido na URL vira "todas"', () => {
        expect(parseTripFilter('xyz')).toBe('all');
        expect(parseTripFilter('road')).toBe('road');
        expect(parseTripFilter(null)).toBe('all');
    });
});

describe('busca de viagem', () => {
    const t = trip({ link: { name: 'Transportes Ágil', vehiclePlate: 'ABC1D23' } as Manifest['link'] });
    it('acha por rota, transportador sem acento, placa e código', () => {
        expect(matchesTripQuery(t, 'recife')).toBe(true);
        expect(matchesTripQuery(t, 'agil')).toBe(true);
        expect(matchesTripQuery(t, 'abc-1d23')).toBe(true);
        expect(matchesTripQuery(t, 'ABCDEF12')).toBe(true);
        expect(matchesTripQuery(t, 'fortaleza salvador')).toBe(false);
        expect(matchesTripQuery(t, '  ')).toBe(true);
    });
});

describe('linha do tempo', () => {
    it('marca Autopilot no encerramento fiscal e no título, e deixa sem data o que não aconteceu', () => {
        const items = tripMilestones(trip({ status: 'IN_PROGRESS', startedAt: '2026-11-02T08:00:00Z' }));
        expect(items.filter((item) => item.mode === 'auto').map((item) => item.key)).toEqual(['fiscal', 'payable']);
        expect(items.find((item) => item.key === 'started')?.at).toBe('2026-11-02T08:00:00Z');
        expect(items.find((item) => item.key === 'completed')?.at).toBeNull();
    });

    it('usa a data de encerramento dos documentos quando concluída e sem documento aberto', () => {
        const items = tripMilestones(trip({ status: 'COMPLETED', fiscalDocuments: [doc({ status: 'CLOSED', closedAt: '2026-11-05T10:00:00Z' })] }));
        expect(items.find((item) => item.key === 'fiscal')?.at).toBe('2026-11-05T10:00:00Z');
    });

    it('documento aberto fica sem data e com nota', () => {
        const items = tripMilestones(trip({ status: 'COMPLETED', fiscalDocuments: [doc({})] }));
        const fiscal = items.find((item) => item.key === 'fiscal');
        expect(fiscal?.at).toBeNull();
        expect(fiscal?.note).toBe('ainda aberto');
    });
});

describe('margem', () => {
    it('custo incompleto não mostra margem nem custo', () => {
        const view = marginView({ costComplete: false, linkId: 'l', linkCost: null, margin: null, missing: ['LinkPricingAgreement not found'], revenueNet: 1000, hubCost: 10 });
        expect(view.hasMargin).toBe(false);
        expect(view.margin).toBeNull();
        expect(view.revenueNet).toBe(1000);
        expect(view.warnings).toHaveLength(1);
        expect(view.warnings[0]).toMatch(/custo do transportador/);
    });

    it('completa traz números e avisa receita estimada', () => {
        const view = marginView({ costComplete: true, margin: 200, marginPercent: 20, linkCost: 700, hubCost: 100, revenueNet: 1000, revenueEstimated: true, ordersWithoutOfficialFreight: 2 });
        expect(view.hasMargin).toBe(true);
        expect(view.marginPercent).toBe(20);
        expect(view.warnings[0]).toMatch(/2 pedidos sem CT-e/);
    });
});
