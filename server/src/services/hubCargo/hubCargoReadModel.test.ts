import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { NfeDistribuicaoDocumento } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { defaultGetCargoDataDeps } from '../fiscal/nfeDistribuicaoCargoData.js';
import { getHubCargoFiscalItem, listHubCargoItems } from './hubCargoReadModel.js';

const capabilities = { canViewOrders: true, canReceive: true, canCreateTrip: true };
const xml = `<nfeProc><NFe><infNFe Id="NFe${'3'.repeat(44)}">
    <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente do XML</xNome></emit>
    <dest><CNPJ>98765432000188</CNPJ><xNome>Destinatário da nota</xNome></dest>
    <transp><vol><qVol>7</qVol><pesoB>153.25</pesoB><pesoL>150</pesoL></vol></transp>
    <total><ICMSTot><vNF>2353.60</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`;

function document(overrides: Partial<NfeDistribuicaoDocumento> = {}): NfeDistribuicaoDocumento {
    return {
        id: 'doc-1',
        status: 'READY_FOR_TRIAGE',
        accessKey: '3'.repeat(44),
        tipo: 'NFE_PROC',
        cnpjEmitente: '12345678000199',
        resumoRaw: { emitente_nome_razao_social: 'Fornecedor do resumo', valor_nfe: 2353.6 },
        xmlStorageKey: 'nfe-distribuicao/doc-1.xml',
        updatedAt: new Date('2026-10-20T12:00:00Z'),
        ...overrides,
    } as NfeDistribuicaoDocumento;
}

describe('dados fiscais da carga do Hub', () => {
    let rows: NfeDistribuicaoDocumento[];
    let originals: Record<string, any>;
    let storageRead: ReturnType<typeof mock.method<typeof defaultGetCargoDataDeps, 'getObjectAsBase64'>>;

    beforeEach(() => {
        rows = [document()];
        const doc = prisma.nfeDistribuicaoDocumento as any;
        const p = prisma as any;
        originals = { findMany: doc.findMany, count: doc.count, findFirst: doc.findFirst, tx: p.$transaction };
        doc.findMany = async () => rows;
        doc.count = async () => rows.length;
        doc.findFirst = async ({ where }: any) => {
            assert.deepEqual(where, {
                id: 'doc-1', status: 'READY_FOR_TRIAGE', fiscalEmitter: { hubId: 'hub-1' },
            });
            return rows[0] ?? null;
        };
        p.$transaction = async (queries: Promise<unknown>[]) => Promise.all(queries);
        storageRead = mock.method(defaultGetCargoDataDeps, 'getObjectAsBase64', async () => Buffer.from(xml).toString('base64'));
    });

    afterEach(() => {
        const doc = prisma.nfeDistribuicaoDocumento as any;
        const p = prisma as any;
        doc.findMany = originals.findMany;
        doc.count = originals.count;
        doc.findFirst = originals.findFirst;
        p.$transaction = originals.tx;
        mock.restoreAll();
    });

    const list = () => listHubCargoItems({
        hubId: 'hub-1', bucket: 'triage', capabilities, limit: 50, offset: 0,
    });
    const getItem = () => getHubCargoFiscalItem('doc-1', 'hub-1', capabilities);

    it('lista nome e valor do resumo sem ler o XML do storage por linha', async () => {
        rows.push(document({ id: 'doc-2' }));
        const result = await list();
        assert.equal(result.total, 2);
        assert.equal(result.items[0].senderName, 'Fornecedor do resumo');
        assert.equal(result.items[0].fiscalValueBRL, 2353.6);
        assert.equal(result.items[0].weightKg, 0);
        assert.equal(result.items[0].recipientName, null);
        assert.equal(storageRead.mock.callCount(), 0);
    });

    it('aceita nomes xNome nos formatos de resumo e NF-e aninhados', async () => {
        rows = [
            document({ resumoRaw: { xNome: 'Nome na raiz', valor_nfe: '45.90' } }),
            document({ resumoRaw: { resNFe: { xNome: 'Nome no resumo' } } }),
            document({ resumoRaw: { nfeProc: { NFe: { infNFe: { emit: { xNome: 'Nome no emitente' } } } } } }),
        ];
        const result = await list();
        assert.deepEqual(result.items.map((item) => item.senderName), [
            'Nome na raiz', 'Nome no resumo', 'Nome no emitente',
        ]);
        assert.equal(result.items[0].fiscalValueBRL, 45.9);
        assert.equal(storageRead.mock.callCount(), 0);
    });

    it('usa CNPJ formatado e valor zero quando o resumo não traz dados válidos', async () => {
        rows = [document({ resumoRaw: { emitente_nome_razao_social: ' ', valor_nfe: 'inválido' } })];
        const result = await list();
        assert.equal(result.items[0].senderName, 'CNPJ 12.345.678/0001-99');
        assert.equal(result.items[0].fiscalValueBRL, 0);
    });

    it('enriquece o detalhe com destinatário, volumes e peso do XML guardado', async () => {
        const item = await getItem();
        assert.equal(item?.senderName, 'Fornecedor do resumo');
        assert.equal(item?.fiscalValueBRL, 2353.6);
        assert.equal(item?.recipientName, 'Destinatário da nota');
        assert.equal(item?.units, 7);
        assert.equal(item?.weightKg, 153.25);
        assert.equal(item?.effectiveWeightKg, 153.25);
        assert.equal(storageRead.mock.callCount(), 1);
        assert.equal(storageRead.mock.calls[0].arguments[0], 'nfe-distribuicao/doc-1.xml');
    });

    it('mantém o detalhe do resumo sem leitura de storage quando não há XML', async () => {
        rows = [document({ xmlStorageKey: null })];
        const item = await getItem();
        assert.equal(item?.senderName, 'Fornecedor do resumo');
        assert.equal(item?.recipientName, null);
        assert.equal(item?.units, 0);
        assert.equal(storageRead.mock.callCount(), 0);
    });

    it('preserva o detalhe consultável se falhar a leitura do XML', async () => {
        storageRead.mock.mockImplementation(async () => { throw new Error('Storage indisponível'); });
        const item = await getItem();
        assert.equal(item?.senderName, 'Fornecedor do resumo');
        assert.equal(item?.fiscalValueBRL, 2353.6);
        assert.equal(item?.weightKg, 0);
        assert.equal(item?.recipientName, null);
    });

    it('retorna null sem ler XML para documento fora do escopo ou da triagem', async () => {
        rows = [];
        assert.equal(await getItem(), null);
        assert.equal(storageRead.mock.callCount(), 0);
    });
});
