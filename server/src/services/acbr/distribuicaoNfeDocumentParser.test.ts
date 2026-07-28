import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDistribuicaoDocumento } from './distribuicaoNfeDocumentParser.js';

describe('parseDistribuicaoDocumento — formato real da ACBr (confirmado ao vivo)', () => {
    it('tipo_documento=nota + resumo=false → NFE_PROC (documento completo já liberado, sem precisar manifestar)', () => {
        // Payload real capturado contra prod.acbr.api.br em 2026-07-28 (cons-chave, chave 1899/GIOPLAST).
        const raw = {
            id: '3a22c067-7c50-484c-92b9-4f4a59a575a8',
            created_at: '2026-07-28T14:15:06.576Z',
            schema: 'procNFe_v4.00.xsd',
            tipo_documento: 'nota',
            chave_acesso: '35260710684336000174550000000018991321178068',
            resumo: false,
            numero_protocolo: '135262831847272',
            valor_nfe: 2353.6,
            emitente_cpf_cnpj: '10684336000174',
            emitente_nome_razao_social: 'GIOPLAST INDUSTRIA, COMERCIO E SERVICOS LTDA',
        };
        const parsed = parseDistribuicaoDocumento(raw, '0');
        assert.equal(parsed.tipo, 'NFE_PROC');
        assert.equal(parsed.accessKey, '35260710684336000174550000000018991321178068');
        assert.equal(parsed.cnpjEmitente, '10684336000174');
    });

    it('tipo_documento=nota + resumo=true → RESUMO (ainda exige manifestação antes do XML completo)', () => {
        const raw = {
            id: '3a22bc9b-1298-4461-8001-f1a75fc958de',
            nsu: 39615,
            tipo_documento: 'nota',
            chave_acesso: '35260753112595000133550010000906661000115525',
            resumo: true,
            emitente_cpf_cnpj: '53112595000133',
        };
        const parsed = parseDistribuicaoDocumento(raw, '0');
        assert.equal(parsed.tipo, 'RESUMO');
        assert.equal(parsed.accessKey, '35260753112595000133550010000906661000115525');
        assert.equal(parsed.cnpjEmitente, '53112595000133');
        assert.equal(parsed.nsu, '39615', 'usa o nsu do próprio documento quando presente (dist-nsu)');
    });

    it('tipo_documento=evento → EVENTO, cnpjEmitente é quem registrou o evento (não o emitente original da NF-e)', () => {
        const raw = {
            id: '3a22bc9b-13b1-4744-a22c-adb28d3d97a5',
            nsu: 39617,
            tipo_documento: 'evento',
            resumo: true,
            chave_acesso: '35260753112595000133550010000906661000115525',
            tipo_evento: '610600',
            emitente_cpf_cnpj: '33683111000107',
        };
        const parsed = parseDistribuicaoDocumento(raw, '0');
        assert.equal(parsed.tipo, 'EVENTO');
        assert.equal(parsed.cnpjEmitente, '33683111000107');
    });

    it('sem "nsu" no próprio documento (cons-chave não traz) → usa o nsu passado por parâmetro', () => {
        const raw = { tipo_documento: 'nota', resumo: false, chave_acesso: '3'.repeat(44), emitente_cpf_cnpj: '12345678000199' };
        const parsed = parseDistribuicaoDocumento(raw, '0');
        assert.equal(parsed.nsu, '0');
    });

    it('tipo_documento desconhecido → DESCONHECIDO mesmo com chave_acesso presente', () => {
        const raw = { tipo_documento: 'algo-novo-que-a-acbr-inventou', chave_acesso: '3'.repeat(44), emitente_cpf_cnpj: '12345678000199' };
        const parsed = parseDistribuicaoDocumento(raw, '0');
        assert.equal(parsed.tipo, 'DESCONHECIDO');
    });
});

describe('parseDistribuicaoDocumento — shape aninhado estilo XML (fallback, nunca confirmado ao vivo)', () => {
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
