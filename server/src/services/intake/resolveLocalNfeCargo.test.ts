import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { resolveLocalNfeCargo } from './resolveLocalNfeCargo.js';
import { ensureNfePartyPersons } from './ensureNfePartyPersons.js';
import type { ParsedNfeCargo } from '../acbr/nfeXmlParser.js';

const CHAVE44 = '35260512345678000190550010000000012345678901';

describe('resolveLocalNfeCargo', () => {
    const origDemandFind = prisma.demand.findUnique.bind(prisma.demand);
    const origDocFind = prisma.nfeDistribuicaoDocumento.findUnique.bind(prisma.nfeDistribuicaoDocumento);
    const origDemandUpdate = prisma.demand.update;
    const origPersonFind = prisma.person.findUnique;
    const origPersonCreate = prisma.person.create;
    const origPersonUpdate = prisma.person.update;

    afterEach(() => {
        prisma.demand.findUnique = origDemandFind;
        prisma.nfeDistribuicaoDocumento.findUnique = origDocFind;
        prisma.demand.update = origDemandUpdate;
        prisma.person.findUnique = origPersonFind;
        prisma.person.create = origPersonCreate;
        prisma.person.update = origPersonUpdate;
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

    it('relê IEs de cache antigo e preenche ambas as pessoas sem substituir cadastro', async () => {
        const stale = {
            chave: CHAVE44,
            emitente: { cnpj: '11111111000111', razaoSocial: 'REM' },
            destinatario: { cnpj: '22222222000122', razaoSocial: 'DEST', indIEDest: '1' },
            produtos: [], valorTotalNota: 1,
        };
        const fresh: ParsedNfeCargo = {
            ...stale,
            emitente: { ...stale.emitente, ie: '00123' },
            destinatario: { ...stale.destinatario, ie: '00456' },
        };
        stub({ sourceType: 'DFE_ACBR', documentKey: CHAVE44, rawInputData: { nfeXmlData: stale } }, { tipo: 'NFE_PROC', xmlStorageKey: 'fake.xml' });
        let persisted: any;
        prisma.demand.update = (async ({ data }: any) => { persisted = data.rawInputData; return {}; }) as any;
        const result = await resolveLocalNfeCargo('d1', async () => fresh);
        assert.equal(result.status, 'available');
        assert.equal(persisted.nfeXmlIeChecked, true);
        assert.equal(persisted.nfeXmlData.emitente.ie, '00123');
        assert.equal(persisted.nfeXmlData.destinatario.ie, '00456');

        const store = new Map<string, any>([
            [stale.emitente.cnpj, { id: 'rem', document: stale.emitente.cnpj, legalName: 'REM', stateRegistration: null }],
            [stale.destinatario.cnpj, { id: 'dest', document: stale.destinatario.cnpj, legalName: 'DEST', stateRegistration: null }],
        ]);
        prisma.person.findUnique = (async ({ where }: any) => store.get(where.document) ?? null) as any;
        prisma.person.update = (async ({ where, data }: any) => {
            const person = [...store.values()].find((item) => item.id === where.id);
            Object.assign(person, data);
            return person;
        }) as any;
        const parties = await ensureNfePartyPersons(fresh);
        assert.equal(parties.remetente?.stateRegistration, '00123');
        assert.equal(parties.destinatario?.stateRegistration, '00456');
        store.get(stale.destinatario.cnpj).stateRegistration = '999';
        assert.equal((await ensureNfePartyPersons(fresh)).destinatario?.stateRegistration, '999');
    });

    it('IE realmente ausente é verificada uma vez e não implica isenção', async () => {
        const cargo = {
            chave: CHAVE44,
            emitente: { cnpj: '11111111000111', razaoSocial: 'REM' },
            destinatario: { cnpj: '22222222000122', razaoSocial: 'DEST', indIEDest: '9' },
            produtos: [], valorTotalNota: 1,
        };
        let raw: any = { nfeXmlData: cargo };
        prisma.demand.findUnique = (async () => ({ id: 'd1', sourceType: 'DFE_ACBR', documentKey: CHAVE44, rawInputData: raw })) as any;
        prisma.nfeDistribuicaoDocumento.findUnique = (async () => ({ tipo: 'NFE_PROC', xmlStorageKey: 'fake.xml' })) as any;
        prisma.demand.update = (async ({ data }: any) => { raw = data.rawInputData; return {}; }) as any;
        let reads = 0;
        const read = async () => { reads++; return cargo; };
        await resolveLocalNfeCargo('d1', read);
        const again = await resolveLocalNfeCargo('d1', read);
        assert.equal(reads, 1);
        assert.equal(again.status, 'available');
        assert.equal(raw.nfeXmlData.destinatario.ie, undefined);
    });

    it('falha ou chave divergente mantém cache, sem gravar resultado inválido', async () => {
        const stale = { chave: CHAVE44, emitente: { cnpj: '11111111000111', razaoSocial: 'REM' } };
        stub({ sourceType: 'DFE_ACBR', documentKey: CHAVE44, rawInputData: { nfeXmlData: stale } }, { tipo: 'NFE_PROC', xmlStorageKey: 'fake.xml' });
        let updates = 0;
        prisma.demand.update = (async () => { updates++; return {}; }) as any;
        const fail = await resolveLocalNfeCargo('d1', async () => { throw new Error('falha simulada'); });
        const wrong = await resolveLocalNfeCargo('d1', async () => ({ ...stale, chave: '9'.repeat(44) }) as ParsedNfeCargo);
        assert.equal(fail.status, 'available');
        assert.equal(wrong.status, 'available');
        if (fail.status === 'available') assert.equal(fail.ieRecovery, 'read_failed');
        if (wrong.status === 'available') assert.equal(wrong.ieRecovery, 'read_failed');
        assert.equal(updates, 0);
    });

    it('avisa quando o XML original não está disponível para recuperar IE antiga', async () => {
        const stale = { chave: CHAVE44, emitente: { cnpj: '11111111000111', razaoSocial: 'REM' } };
        stub({ sourceType: 'DFE_ACBR', documentKey: CHAVE44, rawInputData: { nfeXmlData: stale } }, null);
        const result = await resolveLocalNfeCargo('d1');
        assert.equal(result.status, 'available');
        if (result.status === 'available') assert.equal(result.ieRecovery, 'source_unavailable');
    });

    it('falha ao localizar o XML mantém o cache e avisa a falha', async () => {
        const stale = { chave: CHAVE44, emitente: { cnpj: '11111111000111', razaoSocial: 'REM' } };
        stub({ sourceType: 'DFE_ACBR', documentKey: CHAVE44, rawInputData: { nfeXmlData: stale } }, null);
        prisma.nfeDistribuicaoDocumento.findUnique = (async () => { throw new Error('falha simulada'); }) as any;
        const result = await resolveLocalNfeCargo('d1');
        assert.equal(result.status, 'available');
        if (result.status === 'available') assert.equal(result.ieRecovery, 'read_failed');
    });

    it('reaproveita XML anexado pelo balcão antes de consultar distribuição', async () => {
        const stale = { chave: CHAVE44, emitente: { cnpj: '11111111000111', razaoSocial: 'REM' } };
        stub({ sourceType: 'NFE_KEY', documentKey: CHAVE44, rawInputData: { nfeXmlData: stale, nfeXmlUpload: { storageKey: 'upload.xml' } } }, null);
        prisma.demand.update = (async () => ({})) as any;
        let storageKey: string | null = null;
        const result = await resolveLocalNfeCargo('d1', async (doc) => {
            storageKey = doc.xmlStorageKey;
            return { ...stale, emitente: { ...stale.emitente, ie: '00123' }, destinatario: { cnpj: '', razaoSocial: '' }, produtos: [], valorTotalNota: 1 };
        });
        assert.equal(storageKey, 'upload.xml');
        assert.equal(result.status, 'available');
        if (result.status === 'available') assert.equal(result.source, 'demand');
    });
});
