import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { clearEfreteTokenCache, efreteAuthedGet, efreteAuthedPost, getEfreteToken, isEfreteSessionInvalid } from './efreteAuth.js';
import { EfreteApiError } from './efreteHttp.js';

describe('eFrete auth environment selection', () => {
    const originalEnv = { ...process.env };
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        process.env = { ...originalEnv };
        globalThis.fetch = originalFetch;
        clearEfreteTokenCache();
    });

    it('uses production credentials when env is producao despite EFRETE_ENV homologacao', async () => {
        process.env.EFRETE_ENV = 'homologacao';
        process.env.EFRETE_HOMOLOGACAO_USUARIO = 'hom-user';
        process.env.EFRETE_HOMOLOGACAO_SENHA = 'hom-secret';
        process.env.EFRETE_HOMOLOGACAO_INTEGRADOR = 'hom-integrator';
        process.env.EFRETE_PRODUCAO_USUARIO = 'prod-user';
        process.env.EFRETE_PRODUCAO_SENHA = 'prod-secret';
        process.env.EFRETE_PRODUCAO_INTEGRADOR = 'prod-integrator';
        let body = '';
        globalThis.fetch = (async (_input, init) => {
            body = String(init?.body);
            return new Response(JSON.stringify({ Sucesso: true, Token: 'dummy-token' }), { status: 200 });
        }) as typeof fetch;

        await getEfreteToken('producao');
        assert.match(body, /prod-user/);
        assert.match(body, /prod-secret/);
        assert.match(body, /prod-integrator/);
        assert.doesNotMatch(body, /hom-user/);
    });

    it('rejected login raises LOGIN_REJECTED with lengths/whitespace only, never values', async () => {
        process.env.EFRETE_HOMOLOGACAO_USUARIO = 'usuario@w mesquita';
        process.env.EFRETE_HOMOLOGACAO_SENHA = 'senha#com#hash';
        process.env.EFRETE_HOMOLOGACAO_INTEGRADOR = 'hash-integrador';
        globalThis.fetch = (async () =>
            new Response(JSON.stringify({ Sucesso: false }), { status: 200 })) as typeof fetch;

        await assert.rejects(
            () => getEfreteToken('homologacao'),
            (err: unknown) => {
                assert.ok(err instanceof EfreteApiError);
                assert.equal((err as EfreteApiError).excecaoCodigo, 'LOGIN_REJECTED');
                const msg = (err as Error).message;
                assert.match(msg, /usuario\.length=18/);
                assert.match(msg, /senha\.length=14/);
                assert.match(msg, /Usuario, Senha, Integrador, Versao/);
                assert.match(msg, /contém espaço/);
                assert.doesNotMatch(msg, /usuario@w/);
                assert.doesNotMatch(msg, /senha#com/);
                assert.doesNotMatch(msg, /hash-integrador/);
                return true;
            },
        );
    });

    describe('sessão expirada no provedor', () => {
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
        const notLogged = { Sucesso: false, Excecao: { Mensagem: 'Erro encerrando operação de transporte: Usuário não logado', Codigo: '999' } };

        function stubFetch(handler: (path: string, body: string) => unknown) {
            const calls: { path: string; body: string }[] = [];
            let logins = 0;
            globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
                const url = new URL(String(input));
                const body = String(init?.body ?? url.search);
                calls.push({ path: url.pathname, body });
                if (url.pathname.endsWith('/Logon/Login')) return json({ Sucesso: true, Token: `token-${++logins}` });
                return json(handler(url.pathname, body));
            }) as typeof fetch;
            return { calls, logins: () => logins };
        }
        const setEnv = () => {
            process.env.EFRETE_HOMOLOGACAO_USUARIO = 'u';
            process.env.EFRETE_HOMOLOGACAO_SENHA = 's';
            process.env.EFRETE_HOMOLOGACAO_INTEGRADOR = 'i';
        };

        it('classifica a mensagem de sessão inválida (com e sem acento) e ignora outros erros', () => {
            assert.equal(isEfreteSessionInvalid(new EfreteApiError('x', { excecaoMensagem: 'Usuário não logado' })), true);
            assert.equal(isEfreteSessionInvalid(new EfreteApiError('eFrete /x: Usuario nao logado')), true);
            assert.equal(isEfreteSessionInvalid(new EfreteApiError('x', { excecaoMensagem: 'Token inválido' })), true);
            assert.equal(isEfreteSessionInvalid(new EfreteApiError('x', { excecaoMensagem: 'Sessão expirada' })), true);
            assert.equal(isEfreteSessionInvalid(new EfreteApiError('x', { excecaoMensagem: 'CIOT já encerrado' })), false);
            assert.equal(isEfreteSessionInvalid(new Error('Usuário não logado')), false);
        });

        it('POST: "Usuário não logado" descarta o token em cache, autentica de novo e repete UMA vez com o token novo', async () => {
            setEnv();
            let attempts = 0;
            const stub = stubFetch((_p, body) => (++attempts === 1 ? notLogged : { Sucesso: true, Ok: body.includes('token-2') }));
            await getEfreteToken('homologacao'); // token-1 em cache
            const res = await efreteAuthedPost<{ Sucesso?: boolean; Ok?: boolean }>('/Services/Pef/EncerrarOperacaoTransporte', { X: 1 }, { environment: 'homologacao' });
            assert.equal(res.Ok, true);
            assert.equal(stub.logins(), 2);
            assert.equal(attempts, 2);
        });

        it('GET: mesma recuperação', async () => {
            setEnv();
            let attempts = 0;
            const stub = stubFetch(() => (++attempts === 1 ? notLogged : { Sucesso: true }));
            const res = await efreteAuthedGet<{ Sucesso?: boolean }>('/Services/Pef/Consultar', { A: 1 }, { environment: 'homologacao' });
            assert.equal(res.Sucesso, true);
            assert.equal(stub.logins(), 2);
        });

        it('só repete uma vez: se continuar "não logado", o erro sobe', async () => {
            setEnv();
            let attempts = 0;
            const stub = stubFetch(() => { attempts++; return notLogged; });
            await assert.rejects(efreteAuthedPost('/Services/Pef/X', {}, { environment: 'homologacao' }), /não logado/);
            assert.equal(attempts, 2);
            assert.equal(stub.logins(), 2);
        });

        it('erro de negócio comum NÃO reautentica nem repete', async () => {
            setEnv();
            let attempts = 0;
            const stub = stubFetch(() => { attempts++; return { Sucesso: false, Excecao: { Mensagem: 'CIOT já encerrado', Codigo: '12' } }; });
            await assert.rejects(efreteAuthedPost('/Services/Pef/X', {}, { environment: 'homologacao' }), /já encerrado/);
            assert.equal(attempts, 1);
            assert.equal(stub.logins(), 1);
        });
    });
});
