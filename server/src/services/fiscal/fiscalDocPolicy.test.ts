import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

import {
    getFiscalDocModeForFreight,
    orderEligibleForCteFreight,
    orderEligibleForDceFreight,
} from './fiscalDocPolicy.js';

const U = '550e8400-e29b-41d4-a716-446655440000';
const CHAVE44 = `3520${'1'.repeat(40)}`;

describe('getFiscalDocModeForFreight', () => {
    it('permite CT-e quando há NF-e com chave de 44 dígitos', () => {
        assert.equal(CHAVE44.replace(/\D/g, '').length, 44);
        const mode = getFiscalDocModeForFreight({
            invoicesRel: [{ type: 'NFE', nfKey: CHAVE44 }],
        });
        assert.equal(mode.allowed, 'CTE');
    });

    it('permite DC-e quando há nota OUTRAS com natureza e número', () => {
        const mode = getFiscalDocModeForFreight({
            invoicesRel: [{ type: 'OUTRAS', nfNumber: 'DC-1', nature: 'Declaração teste' }],
        });
        assert.equal(mode.allowed, 'DCE');
    });

    it('bloqueia quando há NF-e válida e OUTRAS ao mesmo tempo', () => {
        const mode = getFiscalDocModeForFreight({
            invoicesRel: [
                { type: 'NFE', nfKey: CHAVE44 },
                { type: 'OUTRAS', nfNumber: 'X', nature: 'Declaração' },
            ],
        });
        assert.equal(mode.allowed, null);
        assert.match(mode.reason, /Conflito/i);
    });

    it('ignora OUTRAS para elegibilidade de CT-e', () => {
        assert.equal(
            orderEligibleForCteFreight({
                invoicesRel: [{ type: 'OUTRAS', nfKey: CHAVE44 }],
            }),
            false,
        );
    });

    it('OUTRAS sem natureza mínima não habilita DC-e', () => {
        assert.equal(
            orderEligibleForDceFreight({
                invoicesRel: [{ type: 'OUTRAS', nfNumber: '1', nature: 'x' }],
            }),
            false,
        );
    });
});

describe('UUID opcionais no payload de frete (mesmo preprocess que freightCalculations)', () => {
    function emptyToNull(v: unknown): unknown {
        if (v === '' || v === undefined) return null;
        return v;
    }

    const nullableUuid = z.preprocess(emptyToNull, z.string().uuid().nullable().optional());

    const nullableDbId = z.preprocess(
        emptyToNull,
        z.union([z.string().min(1).max(128), z.null()]).optional(),
    );

    const freightPayloadShape = z.object({
        documentType: z.enum(['CTE', 'DCE', 'MINUTA']),
        emissorId: z.string().uuid(),
        calculationMethod: z.enum(['ESPECIAL', 'TARIFA_GERAL', 'INFORMADO']),
        pricingTableId: nullableDbId,
        routeId: nullableDbId,
        fiscalEmitterId: nullableUuid,
    });

    it('normaliza strings vazias em UUID opcionais para null (evita Invalid uuid)', () => {
        const parsed = freightPayloadShape.parse({
            documentType: 'MINUTA',
            emissorId: U,
            calculationMethod: 'INFORMADO',
            pricingTableId: '',
            routeId: '',
            fiscalEmitterId: '',
        });
        assert.equal(parsed.pricingTableId, null);
        assert.equal(parsed.routeId, null);
        assert.equal(parsed.fiscalEmitterId, null);
    });

    it('aceita routeId slug legado e pricingTableId UUID (produção route-sp-ma)', () => {
        const tableUuid = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
        const parsed = freightPayloadShape.parse({
            documentType: 'CTE',
            emissorId: U,
            calculationMethod: 'TARIFA_GERAL',
            pricingTableId: tableUuid,
            routeId: 'route-sp-ma',
            fiscalEmitterId: U,
        });
        assert.equal(parsed.routeId, 'route-sp-ma');
        assert.equal(parsed.pricingTableId, tableUuid);
        assert.equal(parsed.fiscalEmitterId, U);
    });
});
