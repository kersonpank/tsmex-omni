import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDistribuicaoDocumento } from './distribuicaoNfeDocumentParser.js';

describe('parseDistribuicaoDocumento', () => {
    it('reconhece um resumo (resNFe) e extrai chave/emitente', () => {
        const raw = {
            resNFe: {
                chNFe: '35260712345678000199550010000012345678901234',
                CNPJ: '12345678000199',
                dhEmi: '2026-07-08T10:00:00-03:00',
                vNF: '1234.56',
            },
        };
        const parsed = parseDistribuicaoDocumento(raw, '1001');
        assert.equal(parsed.tipo, 'RESUMO');
        assert.equal(parsed.accessKey, '35260712345678000199550010000012345678901234');
        assert.equal(parsed.accessKey?.length, 44);
        assert.equal(parsed.cnpjEmitente, '12345678000199');
        assert.equal(parsed.nsu, '1001');
    });

    it('normaliza chave/CNPJ com máscara (pontos, barras, hífen)', () => {
        const raw = {
            resNFe: {
                chNFe: '3526 0712.345.678/0001-99 5500 1000 0012 3456 78901234',
                CNPJ: '12.345.678/0001-99',
            },
        };
        const parsed = parseDistribuicaoDocumento(raw, '1001');
        assert.equal(parsed.accessKey, '35260712345678000199550010000012345678901234');
        assert.equal(parsed.cnpjEmitente, '12345678000199');
    });

    it('reconhece uma NF-e completa (nfeProc) e extrai chave do Id/emitente', () => {
        const raw = {
            nfeProc: {
                NFe: {
                    infNFe: {
                        Id: 'NFe35260712345678000199550010000012345678901234',
                        emit: { CNPJ: '12345678000199' },
                    },
                },
            },
        };
        const parsed = parseDistribuicaoDocumento(raw, '1002');
        assert.equal(parsed.tipo, 'NFE_PROC');
        assert.equal(parsed.accessKey, '35260712345678000199550010000012345678901234');
        assert.equal(parsed.cnpjEmitente, '12345678000199');
    });

    it('reconhece um evento (procEventoNFe) e marca tipo EVENTO', () => {
        const raw = {
            procEventoNFe: {
                evento: {
                    infEvento: {
                        chNFe: '35260712345678000199550010000012345678901234',
                        CNPJ: '12345678000199',
                    },
                },
            },
        };
        const parsed = parseDistribuicaoDocumento(raw, '1003');
        assert.equal(parsed.tipo, 'EVENTO');
        assert.equal(parsed.accessKey, '35260712345678000199550010000012345678901234');
    });

    it('marca DESCONHECIDO quando o schema não bate com nenhum caso conhecido', () => {
        const parsed = parseDistribuicaoDocumento({ algoInesperado: {} }, '1004');
        assert.equal(parsed.tipo, 'DESCONHECIDO');
        assert.equal(parsed.accessKey, null);
        assert.equal(parsed.cnpjEmitente, null);
    });

    it('mantém o tipo reconhecido mas accessKey null quando a chave extraída não tem 44 dígitos', () => {
        const raw = { resNFe: { chNFe: '123', CNPJ: '12345678000199' } };
        const parsed = parseDistribuicaoDocumento(raw, '1005');
        assert.equal(parsed.tipo, 'RESUMO');
        assert.equal(parsed.accessKey, null, 'chave malformada não deve ser aceita mesmo com tipo reconhecido');
    });

    it('preserva o payload bruto em raw', () => {
        const raw = { resNFe: { chNFe: '3'.repeat(44), CNPJ: '12345678000199' } };
        const parsed = parseDistribuicaoDocumento(raw, '1006');
        assert.deepEqual(parsed.raw, raw);
    });
});
