import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildIntakeDemandSearchWhere } from './intakeListQuery.js';

describe('intakeListQuery', () => {
    it('sem q retorna objeto vazio', () => {
        assert.deepEqual(buildIntakeDemandSearchWhere(undefined), {});
        assert.deepEqual(buildIntakeDemandSearchWhere(''), {});
    });

    it('com q monta OR com nfNumber e client document', () => {
        const w = buildIntakeDemandSearchWhere('12345678000190');
        assert.ok('OR' in w && Array.isArray(w.OR));
        assert.ok((w.OR as unknown[]).length >= 3);
    });

    it('UUID válido adiciona filtro por id', () => {
        const id = '550e8400-e29b-41d4-a716-446655440000';
        const w = buildIntakeDemandSearchWhere(id);
        const ors = w.OR as Array<{ id?: string }>;
        assert.ok(ors.some((o) => o.id === id));
    });
});
