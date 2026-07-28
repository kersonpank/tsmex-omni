import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { AcbrHttpError } from './acbrHttp.js';
import {
    isDistribuicaoRateLimitError,
    parseRateLimitMinutes,
    solicitarDistribuicaoNfe,
    type SolicitarDistribuicaoNfeDeps,
} from './acbrDistribuicaoNfe.js';

// Mensagem real capturada ao vivo contra prod.acbr.api.br (2026-07-28).
const RATE_LIMIT_MESSAGE =
    'ACBr /distribuicao/nfe HTTP 400: {"error":{"code":"ValidationFailed","message":"Validation failed: A última solicitação de distribuição foi realizada há menos de 1 hora. Tente novamente em 57 minuto(s)."}}';

describe('isDistribuicaoRateLimitError', () => {
    it('reconhece o erro real de rate-limit (HTTP 400 + "Tente novamente em N minuto(s)")', () => {
        const err = new AcbrHttpError(RATE_LIMIT_MESSAGE, 400);
        assert.equal(isDistribuicaoRateLimitError(err), true);
    });

    it('não confunde um 400 qualquer (sem o texto de rate-limit) com rate-limit', () => {
        const err = new AcbrHttpError('ACBr /distribuicao/nfe HTTP 400: {"error":"CNPJ inválido"}', 400);
        assert.equal(isDistribuicaoRateLimitError(err), false);
    });

    it('não confunde 429 (rate-limit de fila, já tratado por outro caminho) com este 400 específico', () => {
        const err = new AcbrHttpError('ACBr /distribuicao/nfe HTTP 429: rate limited', 429);
        assert.equal(isDistribuicaoRateLimitError(err), false);
    });

    it('não confunde 402 (créditos esgotados) com rate-limit', () => {
        const err = new AcbrHttpError('ACBr /distribuicao/nfe HTTP 402: sem créditos', 402);
        assert.equal(isDistribuicaoRateLimitError(err), false);
    });

    it('erro que não é AcbrHttpError nunca é rate-limit', () => {
        assert.equal(isDistribuicaoRateLimitError(new Error('qualquer coisa')), false);
        assert.equal(isDistribuicaoRateLimitError('string solta'), false);
    });
});

describe('parseRateLimitMinutes', () => {
    it('extrai os minutos exatos da mensagem real da SEFAZ', () => {
        const err = new AcbrHttpError(RATE_LIMIT_MESSAGE, 400);
        assert.equal(parseRateLimitMinutes(err), 57);
    });

    it('cai pro fallback de 60 min se por algum motivo o número não vier (defensivo)', () => {
        const err = new AcbrHttpError('ACBr HTTP 400: Tente novamente em minuto(s).', 400);
        assert.equal(parseRateLimitMinutes(err), 60);
    });
});

function makeDeps(overrides: Partial<SolicitarDistribuicaoNfeDeps> = {}): {
    deps: SolicitarDistribuicaoNfeDeps;
    upsertCalls: unknown[];
} {
    const upsertCalls: unknown[] = [];
    const deps: SolicitarDistribuicaoNfeDeps = {
        acbrFetchJson: mock.fn(async () => ({ ultimo_nsu: 10 })) as any,
        prisma: {
            fiscalDistribuicaoCheckpoint: {
                upsert: (async (args: unknown) => {
                    upsertCalls.push(args);
                    return {};
                }) as any,
            },
        },
        ...overrides,
    };
    return { deps, upsertCalls };
}

describe('solicitarDistribuicaoNfe — grava distNfeNextAllowedAt como side-channel', () => {
    it('sucesso → grava now()+1h, sem alterar o resultado retornado', async () => {
        const { deps, upsertCalls } = makeDeps();
        const before = Date.now();

        const result = await solicitarDistribuicaoNfe(
            { cpf_cnpj: '26879820000270', ambiente: 'producao', tipo_consulta: 'dist-nsu' },
            deps,
        );

        assert.deepEqual(result, { ultimo_nsu: 10 });
        assert.equal(upsertCalls.length, 1);
        const args = upsertCalls[0] as { where: { cpfCnpj_ambiente: { cpfCnpj: string; ambiente: string } }; create: { distNfeNextAllowedAt: Date } };
        assert.equal(args.where.cpfCnpj_ambiente.cpfCnpj, '26879820000270');
        assert.equal(args.where.cpfCnpj_ambiente.ambiente, 'producao');
        const gravado = args.create.distNfeNextAllowedAt.getTime();
        assert.ok(gravado >= before + 59 * 60 * 1000 && gravado <= before + 61 * 60 * 1000, 'deve gravar ~1h no futuro');
    });

    it('erro de rate-limit reconhecido → grava now()+N minutos (valor da SEFAZ) e relança o erro original', async () => {
        const err = new AcbrHttpError(RATE_LIMIT_MESSAGE, 400);
        const { deps, upsertCalls } = makeDeps({
            acbrFetchJson: mock.fn(async () => {
                throw err;
            }) as any,
        });
        const before = Date.now();

        await assert.rejects(
            () => solicitarDistribuicaoNfe({ cpf_cnpj: '26879820000270', ambiente: 'producao', tipo_consulta: 'dist-nsu' }, deps),
            err,
        );

        assert.equal(upsertCalls.length, 1);
        const args = upsertCalls[0] as { create: { distNfeNextAllowedAt: Date } };
        const gravado = args.create.distNfeNextAllowedAt.getTime();
        assert.ok(gravado >= before + 56 * 60 * 1000 && gravado <= before + 58 * 60 * 1000, 'deve gravar ~57min no futuro (valor da SEFAZ)');
    });

    it('outro erro (não rate-limit) → NÃO grava nada, só relança', async () => {
        const err = new Error('ACBr fora do ar');
        const { deps, upsertCalls } = makeDeps({
            acbrFetchJson: mock.fn(async () => {
                throw err;
            }) as any,
        });

        await assert.rejects(
            () => solicitarDistribuicaoNfe({ cpf_cnpj: '26879820000270', ambiente: 'producao', tipo_consulta: 'dist-nsu' }, deps),
            err,
        );

        assert.equal(upsertCalls.length, 0, 'erro que não é rate-limit não deve mexer no cooldown');
    });

    it('falha ao gravar o cooldown não mascara o sucesso da chamada real', async () => {
        const { deps } = makeDeps({
            prisma: {
                fiscalDistribuicaoCheckpoint: {
                    upsert: (async () => {
                        throw new Error('Postgres fora do ar');
                    }) as any,
                },
            },
        });

        const result = await solicitarDistribuicaoNfe(
            { cpf_cnpj: '26879820000270', ambiente: 'producao', tipo_consulta: 'dist-nsu' },
            deps,
        );

        assert.deepEqual(result, { ultimo_nsu: 10 }, 'best-effort: falha ao gravar não deve quebrar o retorno');
    });
});
