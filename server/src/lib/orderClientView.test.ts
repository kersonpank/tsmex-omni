import assert from 'node:assert/strict';
import test from 'node:test';
import { isExternalClientView, sanitizeOrderForClient } from './orderClientView.js';

test('visão externa só para CLIENT sem papel operacional', () => {
    assert.equal(isExternalClientView(['CLIENT']), true);
    assert.equal(isExternalClientView(['CLIENT', 'HUB']), false);
    assert.equal(isExternalClientView(['ADMIN']), false);
});

test('remove XML, storage, transportador e custos; preserva o resto', () => {
    const order = {
        id: 'o1',
        status: 'IN_TRANSIT',
        manifest: { id: 'm1', status: 'IN_PROGRESS', totalValue: 900, linkId: 'l1', link: { name: 'Fulano', document: '123' }, hub: { name: 'SP' } },
        legs: [{ id: 'leg1', allocatedCost: 4321.5, manifest: { id: 'm1', link: { name: 'Fulano' }, totalValue: 900, status: 'ACCEPTED' } }],
        freightCalculations: [{ id: 'c1', freightTotal: 100, cteNumber: '10', ctePdfUrl: 'u', cteXml: '<xml/>', cteXmlStorageKey: 'k', pricingTableId: 'p' }],
        history: [{ id: 'h1' }],
    };
    const out = sanitizeOrderForClient(order);
    const json = JSON.stringify(out);
    for (const secret of ['<xml/>', 'Fulano', '900', '"k"', 'pricingTableId', '4321.5', 'allocatedCost']) assert.ok(!json.includes(secret), secret);
    assert.equal(out.legs[0].id, 'leg1');
    assert.equal(out.manifest.status, 'IN_PROGRESS');
    assert.equal(out.manifest.hub.name, 'SP');
    assert.equal(out.freightCalculations[0].freightTotal, 100);
    assert.equal(out.freightCalculations[0].ctePdfUrl, 'u');
    assert.equal(out.history.length, 1);
    assert.ok('link' in order.manifest, 'não muta o original');
});
