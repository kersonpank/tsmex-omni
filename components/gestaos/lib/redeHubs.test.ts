import { describe, expect, it } from 'vitest';
import type { Hub, Manifest } from '../../../types/index';
import { buildHubRows, redeTotals } from './redeHubs';

const hub = (id: string, extra: Partial<Hub> = {}): Hub => ({ id, name: `Hub ${id}`, code: id.toUpperCase(), city: 'X', state: 'SP', coverageCities: [], canOrchestrate: true, active: true, ...extra });
const trip = (extra: Partial<Manifest>): Manifest => ({ id: 't', status: 'DRAFT', ...extra }) as Manifest;

describe('buildHubRows', () => {
    const hubs = [hub('a'), hub('b', { gatewayHubId: 'a' }), hub('c', { active: false })];
    const summary = { estoque: { pedidosNoCd: 12, pedidosEmTransito: 3, agingMais7d: 2, porHub: [{ hubId: 'a', name: 'A', code: 'A', count: 12 }] } };

    it('junta estoque, exceções e viagens por hub', () => {
        const rows = buildHubRows(
            hubs,
            summary,
            [
                { hubId: 'a', overdue: true },
                { hubId: 'a', overdue: false },
                { hubId: null, overdue: true },
            ],
            [
                trip({ hubId: 'a', destHubId: 'b', status: 'IN_PROGRESS' }),
                trip({ hubId: 'a', destHubId: 'b', status: 'ACCEPTED' }),
                trip({ hubId: 'a', destHubId: 'b', status: 'COMPLETED' }),
                trip({ hubId: 'a', status: 'CANCELLED' }),
            ],
        );
        const a = rows.find((row) => row.hub.id === 'a')!;
        const b = rows.find((row) => row.hub.id === 'b')!;
        expect(a).toMatchObject({ stock: 12, exceptions: 2, overdue: 1, departing: 2, arriving: 0 });
        expect(b).toMatchObject({ stock: 0, exceptions: 0, departing: 0, arriving: 1, gatewayName: 'Hub a' });
    });

    it('hub inativo vai por último', () => {
        expect(buildHubRows(hubs, summary, [], []).map((row) => row.hub.id)).toEqual(['a', 'b', 'c']);
    });

    it('aguenta dados ausentes', () => {
        expect(buildHubRows(hubs, null, null, null)).toHaveLength(3);
    });
});

describe('redeTotals', () => {
    it('conta hubs ativos e lê o resumo', () => {
        const totals = redeTotals([hub('a'), hub('c', { active: false })], { estoque: { pedidosNoCd: 5, pedidosEmTransito: 4, agingMais7d: 1, porHub: [] } });
        expect(totals).toEqual({ activeHubs: 1, stock: 5, inTransit: 4, aged7d: 1 });
    });
});
