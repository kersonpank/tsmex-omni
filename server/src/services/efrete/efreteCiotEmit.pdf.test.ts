import assert from 'node:assert/strict';
import test from 'node:test';
import { obterCiotPdf } from './efreteCiotEmit.js';

const pdf = Buffer.from('%PDF-1.7\n').toString('base64');

test('obterCiotPdf sends authenticated PDF request with explicit environment', async () => {
    let seen: unknown;
    const result = await obterCiotPdf('CIOT-1', 'producao', undefined, (async (...args: unknown[]) => {
        seen = args;
        return { Pdf: pdf };
    }) as any);
    assert.equal(result, pdf);
    assert.deepEqual(seen, ['/Services/Pef/ObterOperacaoTransportePdf', { CodigoIdentificacaoOperacao: 'CIOT-1' }, { environment: 'producao' }]);
});

test('obterCiotPdf rejects empty, malformed, and non-PDF responses', async () => {
    for (const response of [{}, { Pdf: 'not-base64' }, { Pdf: Buffer.from('plain').toString('base64') }]) {
        await assert.rejects(() => obterCiotPdf('CIOT-1', 'homologacao', undefined, (async () => response) as any), /PDF/);
    }
});
