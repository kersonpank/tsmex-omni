import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AcbrCteSubmissionUncertainError, pollCteStatusOnce, submitCteToAcbr, type CteSubmitDeps } from './acbrCteEmit.js';
import type { CteEmissionInput } from '../cteService.js';

const input = { ambiente: 'HOMOLOGACAO', person: {} } as CteEmissionInput;
const emitter = { environment: 'HOMOLOGACAO' as const };

function submitDeps(events: string[], response: unknown = { id: 'doc-1' }): CteSubmitDeps {
    return {
        ensureEmpresaRegistered: async () => { events.push('empresa'); return { ok: true }; },
        buildAcbrCteEmitBody: async () => { events.push('payload'); return { cte: true }; },
        acbrFetchJson: async () => { events.push('POST'); return response; },
    } as unknown as CteSubmitDeps;
}

it('ordena cadastro, payload, marcador e POST, sem chamar a API real', async () => {
    const events: string[] = [];
    const result = await submitCteToAcbr(input, 'ref', emitter, async () => { events.push('marcador'); return true; }, submitDeps(events));
    assert.deepEqual(events, ['empresa', 'payload', 'marcador', 'POST']);
    assert.deepEqual(result, { providerDocId: 'doc-1' });
});

it('não marca nem envia quando a montagem local falha', async () => {
    const events: string[] = [];
    const deps = submitDeps(events);
    deps.buildAcbrCteEmitBody = async () => { events.push('payload'); throw new Error('município'); };
    await assert.rejects(submitCteToAcbr(input, 'ref', emitter, async () => { events.push('marcador'); return true; }, deps), /município/);
    assert.deepEqual(events, ['empresa', 'payload']);
});

it('CAS perdido não chama POST', async () => {
    const events: string[] = [];
    const result = await submitCteToAcbr(input, 'ref', emitter, async () => { events.push('marcador'); return false; }, submitDeps(events));
    assert.deepEqual(events, ['empresa', 'payload', 'marcador']);
    assert.deepEqual(result, { skipped: true });
});

it('resposta sem ID, vazia ou com ID inválido é incerta, nunca rejeição', async () => {
    for (const response of [{}, { id: '  ' }, { id: {} }, null]) {
        const events: string[] = [];
        await assert.rejects(submitCteToAcbr(input, 'ref', emitter, async () => true, submitDeps(events, response)), AcbrCteSubmissionUncertainError);
        assert.equal(events.at(-1), 'POST');
    }
});

it('reconciliação nunca reenvia o documento: só consulta e sincroniza; erro genérico não é rejeição SEFAZ', async () => {
    const calls: Array<{ path: string; method?: string }> = [];
    const fakeFetch = async (path: string, init: { method?: string }) => { calls.push({ path, method: init.method }); return { status: 'erro' }; };
    const result = await pollCteStatusOnce('doc-1', 'HOMOLOGACAO', 6, fakeFetch as CteSubmitDeps['acbrFetchJson']);
    assert.equal(result.kind, 'RECONCILIATION_REQUIRED');
    // A sincronização é uma consulta da situação na SEFAZ; o documento em si (POST /cte) nunca é reenviado.
    assert.deepEqual(calls, [
        { path: '/cte/doc-1', method: 'GET' },
        { path: '/cte/doc-1/sincronizar', method: 'POST' },
        { path: '/cte/doc-1', method: 'GET' },
    ]);
    assert.ok(!calls.some((c) => c.path === '/cte'));
});

it('prioriza cStat e motivo da SEFAZ em rejeição 524, mesmo com erro genérico da ACBr', async () => {
    const fakeFetch = async () => ({
        status: 'erro', codigo_status: 500, motivo_status: 'Erro do provedor',
        autorizacao: { codigo_status: 524, motivo_status: 'Rejeição: CFOP inválido' },
    });
    const outcome = await pollCteStatusOnce('doc-1', 'HOMOLOGACAO', 0, fakeFetch as CteSubmitDeps['acbrFetchJson']);
    assert.equal(outcome.kind, 'REJECTED');
    if (outcome.kind !== 'REJECTED') throw new Error('Esperada rejeição fiscal');
    assert.equal(outcome.result.rejectionCode, '524');
    assert.equal(outcome.result.rejectionReason, 'Rejeição: CFOP inválido');
});

it('duplicidade, rejeição genérica e erros técnicos exigem reconciliação', async () => {
    for (const response of [
        { status: 'rejeitado' },
        { status: 'rejeitado', autorizacao: { cStat: 204, motivo_status: 'Rejeição: Duplicidade de CT-e' } },
        { status: 'erro', autorizacao: { codigo_status: 656, status: 'rejeitado', motivo_status: 'Rejeição: Consumo Indevido' } },
        { status: 'erro', autorizacao: { codigo_status: 999, status: 'rejeitado', motivo_status: 'Erro não catalogado' } },
    ]) {
        const outcome = await pollCteStatusOnce('doc-1', 'HOMOLOGACAO', 0, (async () => response) as CteSubmitDeps['acbrFetchJson']);
        assert.equal(outcome.kind, 'RECONCILIATION_REQUIRED');
        if (outcome.kind === 'RECONCILIATION_REQUIRED' && response.autorizacao?.cStat === 204) assert.equal(outcome.rejectionCode, '204');
    }
});

it('cStat 100 fiscal prevalece sobre erro de topo; processamento continua pendente', async () => {
    const authorized = await pollCteStatusOnce('doc-1', 'HOMOLOGACAO', 0,
        (async () => ({ status: 'erro', autorizacao: { cStat: 100, chave_acesso: '1'.repeat(44), numero_protocolo: '123' } })) as CteSubmitDeps['acbrFetchJson']);
    assert.equal(authorized.kind, 'AUTHORIZED');
    const pending = await pollCteStatusOnce('doc-1', 'HOMOLOGACAO', 0,
        (async () => ({ status: 'processando', motivo_status: 'Em processamento' })) as CteSubmitDeps['acbrFetchJson']);
    assert.equal(pending.kind, 'PENDING');
    const notAuthorized = await pollCteStatusOnce('doc-1', 'HOMOLOGACAO', 0,
        (async () => ({ autorizacao: { status: 'não autorizado' } })) as CteSubmitDeps['acbrFetchJson']);
    assert.equal(notAuthorized.kind, 'PENDING');
});

it('POST /cte espera até 60 s pela SEFAZ (consultas seguem com o padrão curto)', async () => {
    const seen: Array<{ path: string; init: Record<string, unknown> }> = [];
    const deps = submitDeps([]);
    deps.acbrFetchJson = (async (path: string, init: Record<string, unknown>) => { seen.push({ path, init }); return { id: 'doc-1' }; }) as unknown as CteSubmitDeps['acbrFetchJson'];
    await submitCteToAcbr(input, 'ref', emitter, async () => true, deps);
    assert.equal(seen[0].path, '/cte');
    assert.equal(seen[0].init.timeoutMs, 60_000);
    await pollCteStatusOnce('doc-1', 'HOMOLOGACAO', 0, (async (path: string, init: Record<string, unknown>) => { seen.push({ path, init }); return { status: 'pendente' }; }) as unknown as CteSubmitDeps['acbrFetchJson']);
    assert.equal(seen[1].init.timeoutMs, undefined);
});

it('status erro na ACBr (falha de transmissão): sincroniza com a SEFAZ e reavalia', async () => {
    const calls: string[] = [];
    let synced = false;
    const fakeFetch = async (path: string, init: { method: string }) => {
        calls.push(`${init.method} ${path}`);
        if (path.endsWith('/sincronizar')) { synced = true; return {}; }
        return synced
            ? { id: 'doc-1', status: 'autorizado', chave: '3'.repeat(44), autorizacao: { status: 'autorizado', codigo_status: 100, numero_protocolo: '135000000000001', chave_acesso: '3'.repeat(44) } }
            : { id: 'doc-1', status: 'erro', autorizacao: { status: 'erro', motivo_status: 'ESoapClientRequestException: (12002) The request has timed out' } };
    };
    const outcome = await pollCteStatusOnce('doc-1', 'HOMOLOGACAO', 0, fakeFetch as never);
    assert.deepEqual(calls, ['GET /cte/doc-1', 'POST /cte/doc-1/sincronizar', 'GET /cte/doc-1']);
    assert.equal(outcome.kind, 'AUTHORIZED');
});

it('sincronização que falha mantém a conferência pendente, sem rejeitar nem autorizar', async () => {
    const fakeFetch = async (path: string) => {
        if (path.endsWith('/sincronizar')) throw new Error('ACBr HTTP 500');
        return { id: 'doc-1', status: 'erro', autorizacao: { status: 'erro', motivo_status: 'The request has timed out' } };
    };
    const outcome = await pollCteStatusOnce('doc-1', 'HOMOLOGACAO', 0, fakeFetch as never);
    assert.equal(outcome.kind, 'RECONCILIATION_REQUIRED');
});

it('cStat 217 depois da sincronização: CT-e não chegou à SEFAZ, vira rejeição para emitir de novo', async () => {
    const fakeFetch = async (path: string) => (path.endsWith('/sincronizar')
        ? {}
        : { id: 'doc-1', status: 'erro', autorizacao: { status: 'rejeitado', codigo_status: 217, motivo_status: 'Rejeição: CT-e não consta na base de dados da SEFAZ' } });
    const outcome = await pollCteStatusOnce('doc-1', 'HOMOLOGACAO', 0, fakeFetch as never);
    assert.equal(outcome.kind, 'REJECTED');
    assert.match((outcome as { result: { rejectionReason: string } }).result.rejectionReason, /não chegou à SEFAZ/);
});
