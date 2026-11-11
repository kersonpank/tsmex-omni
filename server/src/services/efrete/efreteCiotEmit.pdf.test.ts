import assert from 'node:assert/strict';
import test from 'node:test';
import { obterCiotPdf } from './efreteCiotEmit.js';

const pdf = Buffer.from('%PDF-1.7\n').toString('base64');

test('obterCiotPdf pede o PDF por POST versão 1 no ambiente informado', async () => {
    let seen: unknown;
    const result = await obterCiotPdf('CIOT-1', 'producao', undefined, (async (...args: unknown[]) => {
        seen = args;
        return { Pdf: pdf };
    }) as any);
    assert.equal(result, pdf);
    assert.deepEqual(seen, ['/Services/Pef/ObterOperacaoTransportePdf', { CodigoIdentificacaoOperacao: 'CIOT-1' }, { environment: 'producao', versao: 1 }]);
});

test('obterCiotPdf rejects empty, malformed, and non-PDF responses', async () => {
    for (const response of [{}, { Pdf: 'not-base64' }, { Pdf: Buffer.from('plain').toString('base64') }]) {
        await assert.rejects(() => obterCiotPdf('CIOT-1', 'homologacao', undefined, (async () => response) as any), /PDF/);
    }
});

test('efreteProtocolo converte o protocolo numérico do e-Frete em texto', async () => {
    const { efreteProtocolo } = await import('./efreteCiotEmit.js');
    assert.equal(efreteProtocolo(6176840), '6176840');
    assert.equal(efreteProtocolo('P-1'), 'P-1');
    assert.equal(efreteProtocolo(undefined), undefined);
    assert.equal(efreteProtocolo(null), undefined);
});

test('encerrarCiot usa a versão 2 e só tenta a 3 quando a versão é recusada', async () => {
    const { encerrarCiot } = await import('./efreteCiotEmit.js');
    const { EfreteApiError } = await import('./efreteHttp.js');
    const seen: unknown[] = [];
    await encerrarCiot('CIOT-1', 'HOMOLOGACAO', 315, (async (...args: unknown[]) => { seen.push(args); return { Sucesso: true }; }) as any);
    assert.deepEqual(seen, [['/Services/Pef/EncerrarOperacaoTransporte', { CodigoIdentificacaoOperacao: 'CIOT-1', PesoCarga: 315 }, { environment: 'homologacao', versao: 2 }]]);

    const versions: number[] = [];
    await encerrarCiot('CIOT-1', 'PRODUCAO', 100, (async (_path: string, _body: unknown, opts: { versao: number }) => {
        versions.push(opts.versao);
        if (opts.versao === 2) throw new EfreteApiError('falhou', { excecaoMensagem: 'Erro encerrando operação de transporte: Versão inválida' });
        return { Sucesso: true };
    }) as any);
    assert.deepEqual(versions, [2, 3]);

    await assert.rejects(() => encerrarCiot('CIOT-1', 'HOMOLOGACAO', 100, (async () => { throw new EfreteApiError('x', { excecaoMensagem: 'CIOT já encerrado' }); }) as any), /x/);
    await assert.rejects(() => encerrarCiot('CIOT-1', 'HOMOLOGACAO', 0), /peso transportado/);
    await assert.rejects(() => encerrarCiot('CIOT-1', null), /Ambiente original/);
});
