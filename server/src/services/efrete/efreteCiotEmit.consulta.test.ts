import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { EfreteApiError } from './efreteHttp.js';
import { isCiotNotFoundError, parseConsultaCiot, consultarStatusCiot } from './efreteCiotEmit.js';

describe('isCiotNotFoundError — só "inexistente" libera a emissão do CIOT', () => {
    afterEach(() => { delete process.env.EFRETE_CONSULTA_NOT_FOUND_CODES; });

    it('HTTP 404 e exceção de negócio "não encontrada" → not found', () => {
        assert.equal(isCiotNotFoundError(new EfreteApiError('x', { httpStatus: 404 })), false);
        assert.equal(isCiotNotFoundError(new EfreteApiError('x', { httpStatus: 200, excecaoCodigo: 'Operacao.Nao.Localizada', excecaoMensagem: 'Operação de transporte não localizada.' })), true);
        assert.equal(isCiotNotFoundError(new EfreteApiError('x', { httpStatus: 200, excecaoMensagem: 'Usuário não encontrado.' })), false);
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

it('consulta vazia, incompleta ou sem situação mantém resultado desconhecido', () => {
    for (const response of [{}, { Sucesso: true }, { Sucesso: true, CodigoIdentificacaoOperacao: '123' }]) assert.throws(() => parseConsultaCiot(response), /inconclusiva/);
    assert.equal(parseConsultaCiot({ Sucesso: true, CodigoIdentificacaoOperacao: '123', EstadoCiot: 'EmViagem' }).exists, true);
});

it('consulta usa POST versão 1 e a matriz original; código observado em homologação confirma ausência', async () => {
    let seen: any;
    const post: any = async (...args: any[]) => { seen = args; throw new EfreteApiError('Operação não localizada', { httpStatus: 200, excecaoCodigo: 'Operacao.Nao.Localizada', excecaoMensagem: 'Operação de transporte não localizada' }); };
    const result = await consultarStatusCiot('same-operation', 'homologacao', '11222333000181', post);
    assert.equal(result.exists, false);
    assert.deepEqual(seen, ['/services/Pef/ObterCodigoIdentificacaoOperacaoTransportePorIdOperacaoCliente', { IdOperacaoCliente: 'same-operation', MatrizCNPJ: '11222333000181' }, { environment: 'homologacao', versao: 1 }]);
    await assert.rejects(consultarStatusCiot('same-operation', 'homologacao', '', post), /CNPJ/);
});
