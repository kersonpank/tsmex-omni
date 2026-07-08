import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildManifestacaoBody, CIENCIA_DA_OPERACAO_EVENTO, manifestarCienciaOperacao } from './acbrManifestacao.js';

describe('buildManifestacaoBody', () => {
    it('monta o body para Ciência da Operação (evento 210210) com o schema confirmado da ACBr', () => {
        const body = buildManifestacaoBody({ chaveAcesso: '3'.repeat(44), cpfCnpj: '12345678000199', ambiente: 'homologacao' });
        assert.equal(body.tpEvento, CIENCIA_DA_OPERACAO_EVENTO);
        assert.equal(body.tpEvento, '210210');
        assert.equal(body.chNFe, '3'.repeat(44));
        assert.equal(body.cpf_cnpj, '12345678000199');
        assert.equal(body.ambiente, 'homologacao');
    });

    it('nunca inclui xJust para Ciência da Operação (SEFAZ só exige pra outros eventos)', () => {
        const body = buildManifestacaoBody({ chaveAcesso: '3'.repeat(44), cpfCnpj: '12345678000199', ambiente: 'homologacao' });
        assert.equal('xJust' in body, false);
    });

    it('normaliza a chave e o cpf_cnpj pra apenas dígitos', () => {
        const body = buildManifestacaoBody({
            chaveAcesso: '3526 0712.345.678/0001-99 5500 1000 0012 3456 78901234'.padEnd(44 + 20, '4'),
            cpfCnpj: '12.345.678/0001-99',
            ambiente: 'producao',
        });
        assert.equal(/^\d+$/.test(body.chNFe as string), true);
        assert.equal(body.cpf_cnpj, '12345678000199');
    });
});

describe('manifestarCienciaOperacao', () => {
    it('chama acbrFetchJson com o path, escopos e ambiente corretos', async () => {
        const calls: unknown[] = [];
        const result = await manifestarCienciaOperacao(
            { chaveAcesso: '3'.repeat(44), cpfCnpj: '12345678000199', ambiente: 'homologacao' },
            {
                acbrFetchJson: async (path: string, init: unknown) => {
                    calls.push({ path, init });
                    return { sucesso: true };
                },
            },
        );
        assert.equal(calls.length, 1);
        const call = calls[0] as { path: string; init: { method: string; scopes: string[]; apiEnvironment: string; body: string } };
        assert.equal(call.path, '/distribuicao/nfe/manifestacoes');
        assert.equal(call.init.method, 'POST');
        assert.deepEqual(call.init.scopes, ['empresa', 'nfe', 'distribuicao']);
        assert.equal(call.init.apiEnvironment, 'HOMOLOGACAO');
        assert.deepEqual(result, { sucesso: true });
    });

    it('mapeia ambiente producao para apiEnvironment PRODUCAO', async () => {
        const calls: unknown[] = [];
        await manifestarCienciaOperacao(
            { chaveAcesso: '3'.repeat(44), cpfCnpj: '12345678000199', ambiente: 'producao' },
            { acbrFetchJson: async (path: string, init: unknown) => { calls.push(init); return {}; } },
        );
        const init = calls[0] as { apiEnvironment: string };
        assert.equal(init.apiEnvironment, 'PRODUCAO');
    });
});
