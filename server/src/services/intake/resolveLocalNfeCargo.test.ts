import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { resolveLocalNfeCargo } from './resolveLocalNfeCargo.js';

const CHAVE44 = '35260512345678000190550010000000012345678901';

describe('resolveLocalNfeCargo', () => {
    const origDemandFind = prisma.demand.findUnique.bind(prisma.demand);
    const origDocFind = prisma.nfeDistribuicaoDocumento.findUnique.bind(prisma.nfeDistribuicaoDocumento);

    afterEach(() => {
        prisma.demand.findUnique = origDemandFind;
        prisma.nfeDistribuicaoDocumento.findUnique = origDocFind;
    });

    function stub(demand: Record<string, unknown>, doc: unknown) {
        prisma.demand.findUnique = (async () => ({ id: 'd1', rawInputData: null, ...demand })) as unknown as typeof prisma.demand.findUnique;
        prisma.nfeDistribuicaoDocumento.findUnique = (async () => doc) as unknown as typeof prisma.nfeDistribuicaoDocumento.findUnique;
    }

    it('NFE_KEY sem documento na distribuição → pending', async () => {
        stub({ sourceType: 'NFE_KEY', documentKey: CHAVE44 }, null);
        const result = await resolveLocalNfeCargo('d1');
        assert.equal(result.status, 'pending');
    });

    it('NFE_KEY sem chave de 44 dígitos → pending (manual)', async () => {
        stub({ sourceType: 'NFE_KEY', documentKey: '123' }, null);
        assert.equal((await resolveLocalNfeCargo('d1')).status, 'pending');
    });

    it('DFE_ACBR sem chave → invalid', async () => {
        stub({ sourceType: 'DFE_ACBR', documentKey: null }, null);
        assert.equal((await resolveLocalNfeCargo('d1')).status, 'invalid');
    });

    it('NFE_KEY com nfeXmlData embutido → available (demand)', async () => {
        stub({ sourceType: 'NFE_KEY', documentKey: CHAVE44, rawInputData: { nfeXmlData: { chave: CHAVE44 } } }, null);
        const result = await resolveLocalNfeCargo('d1');
        assert.equal(result.status, 'available');
        if (result.status === 'available') assert.equal(result.source, 'demand');
    });

    it('NFE_KEY com documento sem xmlStorageKey → pending', async () => {
        stub({ sourceType: 'NFE_KEY', documentKey: CHAVE44 }, { tipo: 'NFE_PROC', xmlStorageKey: null });
        assert.equal((await resolveLocalNfeCargo('d1')).status, 'pending');
    });
    it('cache sem documento do destinatário e sem XML guardado → mantém o cache (available)', async () => {
        const stale = { chave: CHAVE44, destinatario: { cnpj: '', razaoSocial: 'MARIA' } };
        stub({ sourceType: 'DFE_ACBR', documentKey: CHAVE44, rawInputData: { nfeXmlData: stale } }, null);
        const result = await resolveLocalNfeCargo('d1');
        assert.equal(result.status, 'available');
        if (result.status === 'available') assert.equal(result.source, 'demand');
    });
});
