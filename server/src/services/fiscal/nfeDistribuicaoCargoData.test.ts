import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { getCargoDataFromDistribuicaoDocument } from './nfeDistribuicaoCargoData.js';
import type { ParsedNfeCargo } from '../acbr/nfeXmlParser.js';

describe('getCargoDataFromDistribuicaoDocument', () => {
    it('retorna null quando o documento não tem xmlStorageKey (ainda não baixado)', async () => {
        const getObjectAsBase64 = mock.fn(async () => 'não deveria ser chamado');
        const result = await getCargoDataFromDistribuicaoDocument(
            { tipo: 'NFE_PROC', xmlStorageKey: null },
            { getObjectAsBase64 },
        );
        assert.equal(result, null);
        assert.equal(getObjectAsBase64.mock.calls.length, 0);
    });

    it('retorna null para documentos RESUMO/EVENTO mesmo com xmlStorageKey presente', async () => {
        const getObjectAsBase64 = mock.fn(async () => 'não deveria ser chamado');
        const result = await getCargoDataFromDistribuicaoDocument(
            { tipo: 'RESUMO', xmlStorageKey: 'nfe-distribuicao/algumachave/xml/arquivo.xml' },
            { getObjectAsBase64 },
        );
        assert.equal(result, null);
        assert.equal(getObjectAsBase64.mock.calls.length, 0);
    });

    it('lê o storage, decodifica base64→utf-8 e parseia o XML quando NFE_PROC com xmlStorageKey', async () => {
        const fakeCargo: ParsedNfeCargo = {
            chave: '3'.repeat(44),
            emitente: { cnpj: '12345678000199', razaoSocial: 'Fornecedor' },
            destinatario: { cnpj: '10256071000103', razaoSocial: 'F C C ABREU LTDA' },
            produtos: [],
            valorTotalNota: 100,
        };
        const xmlContent = '<nfeProc>xml-de-mentira</nfeProc>';
        const base64 = Buffer.from(xmlContent, 'utf-8').toString('base64');
        const getObjectAsBase64 = mock.fn(async (key: string) => {
            assert.equal(key, 'nfe-distribuicao/algumachave/xml/arquivo.xml');
            return base64;
        });
        const parseNfeProcXml = mock.fn((xml: string) => {
            assert.equal(xml, xmlContent);
            return fakeCargo;
        });

        const result = await getCargoDataFromDistribuicaoDocument(
            { tipo: 'NFE_PROC', xmlStorageKey: 'nfe-distribuicao/algumachave/xml/arquivo.xml' },
            { getObjectAsBase64, parseNfeProcXml },
        );

        assert.deepEqual(result, fakeCargo);
        assert.equal(getObjectAsBase64.mock.calls.length, 1);
        assert.equal(parseNfeProcXml.mock.calls.length, 1);
    });
});
