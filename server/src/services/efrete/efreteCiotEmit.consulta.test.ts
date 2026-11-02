import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { EfreteApiError } from './efreteHttp.js';
import { clearEfreteTokenCache } from './efreteAuth.js';
import { consultarStatusCiot, isCiotNotFoundError } from './efreteCiotEmit.js';

describe('isCiotNotFoundError — só "inexistente" libera a emissão do CIOT', () => {
    afterEach(() => { delete process.env.EFRETE_CONSULTA_NOT_FOUND_CODES; });

    it('HTTP 404 e exceção de negócio "não encontrada" → not found', () => {
        assert.equal(isCiotNotFoundError(new EfreteApiError('x', { httpStatus: 404 })), true);
        assert.equal(isCiotNotFoundError(new EfreteApiError('x', { httpStatus: 200, excecaoCodigo: '12', excecaoMensagem: 'Operação de transporte não encontrada.' })), true);
        assert.equal(isCiotNotFoundError(new EfreteApiError('x', { httpStatus: 200, excecaoMensagem: 'Operação inexistente para o IdOperacaoCliente' })), true);
    });

    it('timeout, rede, auth, 5xx, resposta ilegível → NÃO é not found (propaga)', () => {
        assert.equal(isCiotNotFoundError(new EfreteApiError('timeout após 20000ms')), false);
        assert.equal(isCiotNotFoundError(new EfreteApiError('x', { httpStatus: 401, excecaoMensagem: 'Token inválido' })), false);
        assert.equal(isCiotNotFoundError(new EfreteApiError('x', { httpStatus: 500 })), false);
        assert.equal(isCiotNotFoundError(new EfreteApiError('x', { httpStatus: 502, excecaoMensagem: 'operação não encontrada' })), false);
        assert.equal(isCiotNotFoundError(new EfreteApiError('não-JSON', { httpStatus: 200 })), false);
        assert.equal(isCiotNotFoundError(new Error('fetch failed')), false);
        assert.equal(isCiotNotFoundError(undefined), false);
    });

    it('exceção de negócio com mensagem não reconhecida → NÃO é not found', () => {
        assert.equal(isCiotNotFoundError(new EfreteApiError('x', { httpStatus: 200, excecaoCodigo: '77', excecaoMensagem: 'Integrador inválido' })), false);
    });

    it('código extra configurado por env é aceito', () => {
        process.env.EFRETE_CONSULTA_NOT_FOUND_CODES = '77, 91';
        assert.equal(isCiotNotFoundError(new EfreteApiError('x', { httpStatus: 200, excecaoCodigo: '77', excecaoMensagem: 'Integrador inválido' })), true);
    });
});

it('consulta por POST JSON versão 1 com matriz e reconhece Operacao.Nao.Localizada', async () => {
    const originalEnv = { ...process.env };
    const originalFetch = globalThis.fetch;
    const seen: any[] = [];
    Object.assign(process.env, { EFRETE_HOMOLOGACAO_USUARIO: 'test', EFRETE_HOMOLOGACAO_SENHA: 'test', EFRETE_HOMOLOGACAO_INTEGRADOR: 'integrator' });
    clearEfreteTokenCache();
    let exists = false;
    globalThis.fetch = (async (url, init) => {
        if (String(url).includes('ObterCodigoIdentificacao')) {
            seen.push({ method: init?.method, body: JSON.parse(String(init?.body)), url: String(url) });
            return new Response(JSON.stringify(exists ? { Sucesso: true, CodigoIdentificacaoOperacao: '123' } : { Sucesso: false, Excecao: { Codigo: 'Operacao.Nao.Localizada', Mensagem: 'Operação de transporte não localizada' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ Sucesso: true, Token: 'test-token' }), { status: 200 });
    }) as typeof fetch;
    try {
        assert.deepEqual(await consultarStatusCiot('op-1', '04949601000104', 'homologacao'), { exists: false });
        exists = true;
        assert.equal((await consultarStatusCiot('op-1', '04949601000104', 'homologacao')).codigoIdentificacaoOperacao, '123');
        assert.equal(seen[0].method, 'POST');
        assert.deepEqual(seen[0].body, { MatrizCNPJ: '04949601000104', IdOperacaoCliente: 'op-1', Integrador: 'integrator', Token: 'test-token', Versao: 1 });
        assert.equal(new URL(seen[0].url).search, '');
        assert.equal(isCiotNotFoundError(new EfreteApiError('x', { excecaoCodigo: 'Operacao.Nao.Localizada' })), true);
    } finally {
        globalThis.fetch = originalFetch;
        process.env = originalEnv;
        clearEfreteTokenCache();
    }
});
