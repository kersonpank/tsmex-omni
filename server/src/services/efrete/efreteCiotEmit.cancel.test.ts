import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { clearEfreteTokenCache } from './efreteAuth.js';
import { cancelarCiot } from './efreteCiotEmit.js';

describe('cancelarCiot v8.2 KP04', () => {
    const originalEnv = { ...process.env };
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        process.env = { ...originalEnv };
        globalThis.fetch = originalFetch;
        clearEfreteTokenCache();
    });

    it('envia Motivo e versão 1 no ambiente original, sem Justificativa', async () => {
        process.env.EFRETE_HOMOLOGACAO_USUARIO = 'test-user';
        process.env.EFRETE_HOMOLOGACAO_SENHA = 'test-password';
        process.env.EFRETE_HOMOLOGACAO_INTEGRADOR = 'test-integrator';
        let seen: any;
        globalThis.fetch = (async (url, init) => {
            const parsed = new URL(String(url));
            if (parsed.pathname.endsWith('/CancelarOperacaoTransporte')) seen = { origin: parsed.origin, body: JSON.parse(String(init?.body)) };
            return new Response(JSON.stringify({ Sucesso: true, Token: 'test-token' }), { status: 200 });
        }) as typeof fetch;
        clearEfreteTokenCache();
        await cancelarCiot('CIOT-1', 'Viagem cancelada pela operação.', 'HOMOLOGACAO');
        assert.equal(seen.origin, 'https://dev.efrete.com.br');
        assert.equal(seen.body.CodigoIdentificacaoOperacao, 'CIOT-1');
        assert.equal(seen.body.Motivo, 'Viagem cancelada pela operação.');
        assert.equal(seen.body.Versao, 1);
        assert.equal(seen.body.Justificativa, undefined);
    });

    it('recusa cancelamento sem ambiente original conhecido', async () => {
        await assert.rejects(() => cancelarCiot('CIOT-1', 'Viagem cancelada.', null), /Ambiente original do CIOT desconhecido/);
    });
});
