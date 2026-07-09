import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { findCargoDataForChave } from './intakeDemands.js';
import type { ParsedNfeCargo } from '../services/acbr/nfeXmlParser.js';

const CHAVE = '3'.repeat(44);

describe('findCargoDataForChave — glue entre bipagem manual e Distribuição NF-e (ACBr)', () => {
    const original = {
        nfeDistribuicaoDocumentoFindUnique: prisma.nfeDistribuicaoDocumento.findUnique,
    };

    after(() => {
        prisma.nfeDistribuicaoDocumento.findUnique = original.nfeDistribuicaoDocumentoFindUnique;
    });

    it('retorna undefined quando a chave não tem 44 dígitos (não consulta prisma)', async () => {
        let called = false;
        prisma.nfeDistribuicaoDocumento.findUnique = (async () => {
            called = true;
            return null;
        }) as unknown as typeof prisma.nfeDistribuicaoDocumento.findUnique;

        const result = await findCargoDataForChave('123');
        assert.equal(result, undefined);
        assert.equal(called, false);
    });

    it('retorna undefined quando não há NfeDistribuicaoDocumento pra chave', async () => {
        prisma.nfeDistribuicaoDocumento.findUnique = (async () => null) as unknown as typeof prisma.nfeDistribuicaoDocumento.findUnique;

        const result = await findCargoDataForChave(CHAVE);
        assert.equal(result, undefined);
    });

    it('encontra o documento e repassa os deps injetados pra extrair cargoData real', async () => {
        prisma.nfeDistribuicaoDocumento.findUnique = (async ({ where }: any) => {
            assert.equal(where.accessKey, CHAVE);
            return { tipo: 'NFE_PROC', xmlStorageKey: 'nfe-distribuicao/x/xml/arquivo.xml' };
        }) as unknown as typeof prisma.nfeDistribuicaoDocumento.findUnique;

        const fakeCargo: ParsedNfeCargo = {
            chave: CHAVE,
            emitente: { cnpj: '12345678000199', razaoSocial: 'Fornecedor' },
            destinatario: { cnpj: '10256071000103', razaoSocial: 'F C C ABREU LTDA' },
            produtos: [],
            valorTotalNota: 500,
        };

        const result = await findCargoDataForChave(CHAVE, {
            getObjectAsBase64: async (key) => {
                assert.equal(key, 'nfe-distribuicao/x/xml/arquivo.xml');
                return Buffer.from('<nfeProc/>', 'utf-8').toString('base64');
            },
            parseNfeProcXml: () => fakeCargo,
        });

        assert.deepEqual(result, fakeCargo);
    });

    it('degrada graciosamente (undefined) quando a leitura/parse do XML falha, sem lançar', async () => {
        prisma.nfeDistribuicaoDocumento.findUnique = (async () => ({
            tipo: 'NFE_PROC',
            xmlStorageKey: 'nfe-distribuicao/x/xml/arquivo.xml',
        })) as unknown as typeof prisma.nfeDistribuicaoDocumento.findUnique;

        const result = await findCargoDataForChave(CHAVE, {
            getObjectAsBase64: async () => {
                throw new Error('S3 indisponível (simulado)');
            },
        });

        assert.equal(result, undefined);
    });
});
