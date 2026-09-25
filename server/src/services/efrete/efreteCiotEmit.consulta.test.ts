import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { EfreteApiError } from './efreteHttp.js';
import { isCiotNotFoundError } from './efreteCiotEmit.js';

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
