import { describe, expect, it } from 'vitest';
import { canCancelMdfe } from './MdfeEvents';

describe('canCancelMdfe', () => {
    const now = Date.parse('2026-11-25T12:00:00Z');
    it('só autorizado e dentro de 24 h da autorização', () => {
        expect(canCancelMdfe({ status: 'AUTHORIZED', authorizedAt: '2026-11-25T01:00:00Z' }, now)).toBe(true);
        expect(canCancelMdfe({ status: 'AUTHORIZED', authorizedAt: '2026-11-24T11:59:00Z' }, now)).toBe(false);
        expect(canCancelMdfe({ status: 'CLOSED', authorizedAt: '2026-11-25T11:00:00Z' }, now)).toBe(false);
    });
});
