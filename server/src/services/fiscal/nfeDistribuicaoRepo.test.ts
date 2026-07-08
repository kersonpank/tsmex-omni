import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NfeDistribuicaoRepoDeps } from './nfeDistribuicaoRepo.js';
import {
    listReadyForTriage,
    markConverted,
    markDiscarded,
    markManifested,
    markXmlDownloaded,
    upsertDiscovered,
} from './nfeDistribuicaoRepo.js';

type FakeDoc = {
    id: string;
    nsu: string;
    accessKey: string;
    tipo: string;
    cnpjEmitente: string;
    ambiente: string;
    fiscalEmitterId: string;
    fiscalEmitter?: { hubId: string | null };
    resumoRaw: unknown;
    status: string;
    manifestedAt: Date | null;
    xmlDownloadedAt: Date | null;
    xmlStorageKey: string | null;
    convertedDemandId: string | null;
    convertedAt: Date | null;
    discardedAt: Date | null;
    discardedByUserId: string | null;
    createdAt: Date;
};

function makeFakePrisma(seed: FakeDoc[] = []) {
    const store = [...seed];
    let nextId = 1;

    const deps: NfeDistribuicaoRepoDeps = {
        prisma: {
            nfeDistribuicaoDocumento: {
                findUnique: (async ({ where }: any) => store.find((d) => d.accessKey === where.accessKey) ?? null) as any,
                create: (async ({ data }: any) => {
                    const doc: FakeDoc = {
                        id: `doc-${nextId++}`,
                        status: 'DISCOVERED',
                        manifestedAt: null,
                        xmlDownloadedAt: null,
                        xmlStorageKey: null,
                        convertedDemandId: null,
                        convertedAt: null,
                        discardedAt: null,
                        discardedByUserId: null,
                        createdAt: new Date(),
                        ...data,
                    };
                    store.push(doc);
                    return doc;
                }) as any,
                updateMany: (async ({ where, data }: any) => {
                    let count = 0;
                    for (const doc of store) {
                        if (doc.id !== where.id) continue;
                        if (where.status && doc.status !== where.status) continue;
                        if ('xmlDownloadedAt' in where && doc.xmlDownloadedAt !== where.xmlDownloadedAt) continue;
                        Object.assign(doc, data);
                        count += 1;
                    }
                    return { count };
                }) as any,
                update: (async ({ where, data }: any) => {
                    const doc = store.find((d) => d.id === where.id);
                    if (!doc) throw new Error('not found');
                    Object.assign(doc, data);
                    return doc;
                }) as any,
                findMany: (async ({ where }: any) => {
                    return store.filter((d) => {
                        if (where.status && d.status !== where.status) return false;
                        if (where.fiscalEmitterId && d.fiscalEmitterId !== where.fiscalEmitterId) return false;
                        if (where.fiscalEmitter?.hubId && d.fiscalEmitter?.hubId !== where.fiscalEmitter.hubId) return false;
                        return true;
                    });
                }) as any,
            },
        },
    };
    return { deps, store };
}

describe('upsertDiscovered', () => {
    it('cria um documento novo quando accessKey não existe', async () => {
        const { deps, store } = makeFakePrisma();
        const doc = await upsertDiscovered(
            { nsu: '1001', accessKey: '3'.repeat(44), tipo: 'RESUMO', cnpjEmitente: '12345678000199', ambiente: 'homologacao', fiscalEmitterId: 'fe-1', resumoRaw: {} },
            deps,
        );
        assert.equal(doc.status, 'DISCOVERED');
        assert.equal(store.length, 1);
    });

    it('não duplica nem regride quando accessKey já existe (idempotente)', async () => {
        const { deps, store } = makeFakePrisma();
        const input = { nsu: '1001', accessKey: '3'.repeat(44), tipo: 'RESUMO' as const, cnpjEmitente: '12345678000199', ambiente: 'homologacao', fiscalEmitterId: 'fe-1', resumoRaw: {} };
        const first = await upsertDiscovered(input, deps);
        await markManifested(first.id, deps); // avança pra MANIFESTED
        const second = await upsertDiscovered(input, deps);
        assert.equal(second.id, first.id);
        assert.equal((second as any).status, 'MANIFESTED', 'não deve regredir o status pra DISCOVERED de novo');
        assert.equal(store.length, 1);
    });
});

describe('markManifested / markXmlDownloaded — compare-and-swap', () => {
    it('transiciona DISCOVERED -> MANIFESTED -> READY_FOR_TRIAGE', async () => {
        const { deps, store } = makeFakePrisma([
            {
                id: 'doc-1', nsu: '1', accessKey: 'k1', tipo: 'RESUMO', cnpjEmitente: 'c1', ambiente: 'homologacao', fiscalEmitterId: 'fe-1',
                resumoRaw: {}, status: 'DISCOVERED', manifestedAt: null, xmlDownloadedAt: null, xmlStorageKey: null,
                convertedDemandId: null, convertedAt: null, discardedAt: null, discardedByUserId: null, createdAt: new Date(),
            },
        ]);
        const manifested = await markManifested('doc-1', deps);
        assert.equal(manifested, true);
        assert.equal(store[0].status, 'MANIFESTED');

        const downloaded = await markXmlDownloaded('doc-1', 'nfe-distribuicao/k1/xml', deps);
        assert.equal(downloaded, true);
        assert.equal(store[0].status, 'READY_FOR_TRIAGE');
        assert.equal(store[0].xmlStorageKey, 'nfe-distribuicao/k1/xml');
    });

    it('markXmlDownloaded é no-op (idempotente) se já baixado antes', async () => {
        const { deps, store } = makeFakePrisma([
            {
                id: 'doc-1', nsu: '1', accessKey: 'k1', tipo: 'RESUMO', cnpjEmitente: 'c1', ambiente: 'homologacao', fiscalEmitterId: 'fe-1',
                resumoRaw: {}, status: 'READY_FOR_TRIAGE', manifestedAt: new Date(), xmlDownloadedAt: new Date('2026-01-01'), xmlStorageKey: 'ja-existe',
                convertedDemandId: null, convertedAt: null, discardedAt: null, discardedByUserId: null, createdAt: new Date(),
            },
        ]);
        const result = await markXmlDownloaded('doc-1', 'novo-key-nunca-deveria-sobrescrever', deps);
        assert.equal(result, false, 'não deve reprocessar/sobrescrever quando já baixado');
        assert.equal(store[0].xmlStorageKey, 'ja-existe');
    });

    it('markManifested retorna false se o doc não estava em DISCOVERED (evita manifestar 2x)', async () => {
        const { deps, store } = makeFakePrisma([
            {
                id: 'doc-1', nsu: '1', accessKey: 'k1', tipo: 'RESUMO', cnpjEmitente: 'c1', ambiente: 'homologacao', fiscalEmitterId: 'fe-1',
                resumoRaw: {}, status: 'MANIFESTED', manifestedAt: new Date(), xmlDownloadedAt: null, xmlStorageKey: null,
                convertedDemandId: null, convertedAt: null, discardedAt: null, discardedByUserId: null, createdAt: new Date(),
            },
        ]);
        const result = await markManifested('doc-1', deps);
        assert.equal(result, false);
        assert.equal(store[0].status, 'MANIFESTED');
    });
});

describe('listReadyForTriage', () => {
    it('filtra por status READY_FOR_TRIAGE e por hub do fiscalEmitter', async () => {
        const { deps } = makeFakePrisma([
            { id: 'd1', nsu: '1', accessKey: 'k1', tipo: 'RESUMO', cnpjEmitente: 'c', ambiente: 'homologacao', fiscalEmitterId: 'fe-1', fiscalEmitter: { hubId: 'hub-A' }, resumoRaw: {}, status: 'READY_FOR_TRIAGE', manifestedAt: new Date(), xmlDownloadedAt: new Date(), xmlStorageKey: 'x', convertedDemandId: null, convertedAt: null, discardedAt: null, discardedByUserId: null, createdAt: new Date() },
            { id: 'd2', nsu: '2', accessKey: 'k2', tipo: 'RESUMO', cnpjEmitente: 'c', ambiente: 'homologacao', fiscalEmitterId: 'fe-2', fiscalEmitter: { hubId: 'hub-B' }, resumoRaw: {}, status: 'READY_FOR_TRIAGE', manifestedAt: new Date(), xmlDownloadedAt: new Date(), xmlStorageKey: 'x', convertedDemandId: null, convertedAt: null, discardedAt: null, discardedByUserId: null, createdAt: new Date() },
            { id: 'd3', nsu: '3', accessKey: 'k3', tipo: 'RESUMO', cnpjEmitente: 'c', ambiente: 'homologacao', fiscalEmitterId: 'fe-1', fiscalEmitter: { hubId: 'hub-A' }, resumoRaw: {}, status: 'DISCOVERED', manifestedAt: null, xmlDownloadedAt: null, xmlStorageKey: null, convertedDemandId: null, convertedAt: null, discardedAt: null, discardedByUserId: null, createdAt: new Date() },
        ]);
        const forHubA = await listReadyForTriage({ hubId: 'hub-A' }, deps);
        assert.equal(forHubA.length, 1);
        assert.equal((forHubA[0] as any).id, 'd1');
    });
});

describe('markConverted / markDiscarded — compare-and-swap', () => {
    it('converte um doc READY_FOR_TRIAGE e não permite converter de novo', async () => {
        const { deps, store } = makeFakePrisma([
            { id: 'd1', nsu: '1', accessKey: 'k1', tipo: 'RESUMO', cnpjEmitente: 'c', ambiente: 'homologacao', fiscalEmitterId: 'fe-1', resumoRaw: {}, status: 'READY_FOR_TRIAGE', manifestedAt: new Date(), xmlDownloadedAt: new Date(), xmlStorageKey: 'x', convertedDemandId: null, convertedAt: null, discardedAt: null, discardedByUserId: null, createdAt: new Date() },
        ]);
        const first = await markConverted('d1', 'demand-1', deps);
        assert.equal(first, true);
        assert.equal(store[0].status, 'CONVERTED');
        assert.equal(store[0].convertedDemandId, 'demand-1');

        const second = await markConverted('d1', 'demand-2', deps);
        assert.equal(second, false, 'não pode converter de novo um doc que já foi convertido');
        assert.equal(store[0].convertedDemandId, 'demand-1', 'não deve sobrescrever a demanda já vinculada');
    });

    it('descarta um doc READY_FOR_TRIAGE', async () => {
        const { deps, store } = makeFakePrisma([
            { id: 'd1', nsu: '1', accessKey: 'k1', tipo: 'RESUMO', cnpjEmitente: 'c', ambiente: 'homologacao', fiscalEmitterId: 'fe-1', resumoRaw: {}, status: 'READY_FOR_TRIAGE', manifestedAt: new Date(), xmlDownloadedAt: new Date(), xmlStorageKey: 'x', convertedDemandId: null, convertedAt: null, discardedAt: null, discardedByUserId: null, createdAt: new Date() },
        ]);
        const result = await markDiscarded('d1', 'user-1', deps);
        assert.equal(result, true);
        assert.equal(store[0].status, 'DISCARDED');
        assert.equal(store[0].discardedByUserId, 'user-1');
    });
});
