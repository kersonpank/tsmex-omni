import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { attachNfeXmlToDemand, type AttachNfeXmlDeps } from './attachNfeXml.js';

const CHAVE = '35260712345678000199550010000012345678901234';
const xmlFor = (chave: string) => `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${chave}"></infNFe></NFe></nfeProc>`;

const deps = (over: Partial<AttachNfeXmlDeps> = {}): AttachNfeXmlDeps => ({
    parse: (xml) => ({ chave: /NFe(\d{44})/.exec(xml)?.[1] ?? '' }) as never,
    upload: async () => ({ storageKey: 'nfe-xml/k.xml' }),
    isStorageConfigured: () => true,
    ...over,
});

describe('attachNfeXmlToDemand', () => {
    const origFind = prisma.demand.findUnique.bind(prisma.demand);
    const origUpdate = prisma.demand.update.bind(prisma.demand);
    let updated: any = null;

    afterEach(() => {
        prisma.demand.findUnique = origFind;
        prisma.demand.update = origUpdate;
        updated = null;
    });

    function stub(row: Record<string, unknown> | null) {
        prisma.demand.findUnique = (async () => row) as never;
        prisma.demand.update = (async (args: unknown) => { updated = args; return {}; }) as never;
    }
    const base = { id: 'd1', status: 'AWAITING_ARRIVAL', documentKey: CHAVE, rawInputData: { x: 1 } };

    it('chave diferente → 400 com final da chave', async () => {
        stub(base);
        await assert.rejects(
            attachNfeXmlToDemand({ demandId: 'd1', xml: xmlFor('3'.repeat(44)) }, deps()),
            (e: any) => e.statusCode === 400 && e.message.includes('outra nota') && e.message.includes('33333333'),
        );
        assert.equal(updated, null);
    });

    it('sem chave na demanda → 400', async () => {
        stub({ ...base, documentKey: null });
        await assert.rejects(attachNfeXmlToDemand({ demandId: 'd1', xml: xmlFor(CHAVE) }, deps()), (e: any) => e.statusCode === 400);
    });

    it('status diferente de AWAITING_ARRIVAL → 400', async () => {
        stub({ ...base, status: 'CONVERTED' });
        await assert.rejects(attachNfeXmlToDemand({ demandId: 'd1', xml: xmlFor(CHAVE) }, deps()), (e: any) => e.statusCode === 400);
    });

    it('DOCTYPE/ENTITY → 400', async () => {
        stub(base);
        await assert.rejects(
            attachNfeXmlToDemand({ demandId: 'd1', xml: `<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]>${xmlFor(CHAVE)}` }, deps()),
            (e: any) => e.statusCode === 400,
        );
    });

    it('XML correto → grava nfeXmlData e nfeXmlUpload', async () => {
        stub(base);
        const cargo = await attachNfeXmlToDemand({ demandId: 'd1', xml: xmlFor(CHAVE), actorUserId: 'u1' }, deps());
        assert.equal(cargo.chave, CHAVE);
        const raw = updated.data.rawInputData;
        assert.equal(raw.x, 1);
        assert.equal(raw.nfeXmlData.chave, CHAVE);
        assert.equal(raw.nfeXmlUpload.storageKey, 'nfe-xml/k.xml');
        assert.equal(raw.nfeXmlUpload.uploadedByUserId, 'u1');
        assert.equal(raw.nfeXmlUpload.checksum.length, 64);
    });

    it('storage indisponível → grava com storageKey null', async () => {
        stub(base);
        await attachNfeXmlToDemand({ demandId: 'd1', xml: xmlFor(CHAVE) }, deps({ upload: async () => { throw new Error('boom'); } }));
        assert.equal(updated.data.rawInputData.nfeXmlUpload.storageKey, null);
        assert.ok(updated.data.rawInputData.nfeXmlData);
    });
});
