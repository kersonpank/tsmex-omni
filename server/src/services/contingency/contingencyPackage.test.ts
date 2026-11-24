import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTINGENCY_COLUMNS, loadContingencyRows, toContingencyCsv } from './contingencyPackage.js';

test('CSV com ; e BOM, aspas só quando precisa, datas em ISO', () => {
    const csv = toContingencyCsv([
        { pedido: 101, remetente: 'ACME; Filial "Norte"', peso_kg: 12.5, entrou_no_hub_em: new Date('2026-11-24T10:00:00Z'), placas: null },
    ], ['pedido', 'remetente', 'peso_kg', 'entrou_no_hub_em', 'placas']);
    assert.ok(csv.startsWith('﻿pedido;remetente;peso_kg;entrou_no_hub_em;placas\r\n'));
    assert.ok(csv.includes('101;"ACME; Filial ""Norte""";12.5;2026-11-24T10:00:00.000Z;\r\n'));
});

test('a view existe e devolve as colunas do pacote', { skip: !process.env.DATABASE_URL }, async () => {
    const rows = await loadContingencyRows();
    assert.ok(Array.isArray(rows));
    const csv = toContingencyCsv(rows, CONTINGENCY_COLUMNS);
    assert.equal(csv.split('\r\n')[0], `﻿${CONTINGENCY_COLUMNS.join(';')}`);
    if (rows[0]) assert.deepEqual(Object.keys(rows[0]).sort(), [...CONTINGENCY_COLUMNS].sort());
});
