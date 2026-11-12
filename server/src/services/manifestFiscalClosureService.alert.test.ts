import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { closeFiscalDocumentsForCompletedManifest } from './manifestFiscalClosureService.js';

describe('encerramento fiscal: alerta não duplica a cada tentativa automática', () => {
    const original = {
        docs: prisma.manifestFiscalDocument.findMany,
        manifest: prisma.manifest.findUnique,
        alertFind: prisma.systemAlert.findMany,
        alertCreate: prisma.systemAlert.create,
        alertUpdate: prisma.systemAlert.update,
    };
    afterEach(() => {
        prisma.manifestFiscalDocument.findMany = original.docs;
        prisma.manifest.findUnique = original.manifest;
        prisma.systemAlert.findMany = original.alertFind;
        prisma.systemAlert.create = original.alertCreate;
        prisma.systemAlert.update = original.alertUpdate;
    });

    it('a 2ª falha do mesmo documento mescla no alerta aberto em vez de criar outro', async () => {
        const store: Record<string, any>[] = [];
        prisma.manifestFiscalDocument.findMany = (async () => [{ id: 'doc-1', documentType: 'CIOT', number: null }]) as any;
        prisma.manifest.findUnique = (async () => ({ hubId: 'hub-1' })) as any;
        prisma.systemAlert.findMany = (async () => store.filter((a) => a.status === 'OPEN')) as any;
        prisma.systemAlert.create = (async ({ data }: any) => { store.push({ id: `a${store.length}`, status: 'OPEN', createdAt: new Date(), ...data }); return data; }) as any;
        prisma.systemAlert.update = (async ({ where, data }: any) => { Object.assign(store.find((a) => a.id === where.id)!, data); return data; }) as any;

        const first = await closeFiscalDocumentsForCompletedManifest('manifest-1');
        const second = await closeFiscalDocumentsForCompletedManifest('manifest-1');
        const third = await closeFiscalDocumentsForCompletedManifest('manifest-1');
        assert.deepEqual([first, second, third], [['doc-1'], ['doc-1'], ['doc-1']]);
        assert.equal(store.length, 1);
        assert.equal(store[0].hubId, 'hub-1');
        assert.equal(store[0].context.occurrences, 3);
    });
});
