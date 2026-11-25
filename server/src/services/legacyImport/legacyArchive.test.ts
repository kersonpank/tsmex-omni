import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { archiveLegacyRows, detectKeyColumn, legacyArchiveSummary, parseLegacyExport, searchLegacyArchive } from './legacyArchive.js';

describe('arquivo do legado', () => {
    const clean = () => prisma.legacyRecord.deleteMany({ where: { entity: { in: ['pedidos_teste', 'titulos_teste'] } } });
    before(clean);
    after(clean);

    it('lê CSV, JSON com coleção e JSON Lines', () => {
        assert.equal(parseLegacyExport('Número;Remetente\n10;ACME\n').length, 1);
        assert.deepEqual(parseLegacyExport('{"total":2,"dados":{"itens":[{"a":1},{"a":2}]}}', { collection: 'dados.itens' }), [{ a: 1 }, { a: 2 }]);
        assert.equal(parseLegacyExport('{"totais":{"x":1},"lista":[{"a":1},{"a":2},{"a":3}]}').length, 3);
        assert.equal(parseLegacyExport('{"a":1}\n{"a":2}\n').length, 2);
    });

    it('chave automática só quando preenchida e única', () => {
        assert.equal(detectKeyColumn([{ numero: '1' }, { numero: '2' }]), 'numero');
        assert.equal(detectKeyColumn([{ numero: '1' }, { numero: '1' }]), null);
        assert.throws(() => detectKeyColumn([{ a: 1 }], 'inexistente'), /não existe/);
    });

    it('idempotente: reimportar não duplica; linha alterada atualiza e conta revisão', async () => {
        const rows = parseLegacyExport('Número;Remetente;CNPJ;Valor\n1001;Transportes São João;11.222.333/0001-81;1.234,56\n1002;ACME;99.888.777/0001-66;10,00\n1002;ACME;99.888.777/0001-66;10,00\n');
        const first = await archiveLegacyRows('Pedidos Teste', rows, { sourceFile: 'pedidos-2025.csv' });
        assert.deepEqual([first.entity, first.keyColumn, first.created, first.unchanged], ['pedidos_teste', null, 2, 1]);
        // Sem chave única (1002 repetido), reimportar o mesmo arquivo não cria nada novo.
        const again = await archiveLegacyRows('pedidos_teste', rows);
        assert.deepEqual([again.created, again.updated], [0, 0]);

        const keyed = parseLegacyExport('numero;situacao\nT-1;aberto\nT-2;pago\n');
        await archiveLegacyRows('titulos_teste', keyed);
        const changed = await archiveLegacyRows('titulos_teste', parseLegacyExport('numero;situacao\nT-1;pago\nT-2;pago\n'));
        assert.deepEqual([changed.keyColumn, changed.created, changed.updated, changed.unchanged], ['numero', 0, 1, 1]);
        const t1 = await prisma.legacyRecord.findUniqueOrThrow({ where: { entity_legacyKey: { entity: 'titulos_teste', legacyKey: 'T-1' } } });
        assert.equal(t1.revisions, 1);
        assert.deepEqual(t1.data, { numero: 'T-1', situacao: 'pago' });
    });

    it('busca por nome sem acento, por CNPJ com ou sem máscara, e resumo por tipo', async () => {
        assert.equal((await searchLegacyArchive({ q: 'sao joao' })).total, 1);
        assert.equal((await searchLegacyArchive({ q: '11222333000181' })).total, 1);
        assert.equal((await searchLegacyArchive({ q: '11.222.333/0001-81', entity: 'pedidos_teste' })).total, 1);
        assert.equal((await searchLegacyArchive({ entity: 'titulos_teste' })).total, 2);
        const summary = await legacyArchiveSummary();
        assert.deepEqual(summary.filter((s) => s.entity.endsWith('_teste')).map((s) => [s.entity, s.count]), [['pedidos_teste', 2], ['titulos_teste', 2]]);
    });
});
