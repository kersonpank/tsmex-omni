import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { enqueueCteEmissionJob, type CteEmissionJobData } from './cteEmissionQueue.js';

function makeFakeQueue(idsAlreadyAdded = new Set<string>()) {
    const calls: unknown[] = [];
    const add = mock.fn(async (name: string, data: CteEmissionJobData, opts?: { jobId?: string }) => {
        calls.push({ name, data, opts });
        // Simula o comportamento real do BullMQ: add() com um jobId já existente é idempotente
        // (não lança, não duplica — só devolve a referência do job existente).
        return { id: opts?.jobId ?? 'auto-generated-id' };
    });
    return { queue: { add }, calls, idsAlreadyAdded };
}

describe('enqueueCteEmissionJob', () => {
    it('usa cteEmissionJobId como jobId determinístico do BullMQ (nunca deixa o BullMQ gerar um)', async () => {
        const { queue, calls } = makeFakeQueue();
        const data: CteEmissionJobData = { calcId: 'calc-1', cteEmissionJobId: 'job-uuid-abc', phaseHint: 'submit' };

        const returnedId = await enqueueCteEmissionJob(data, queue as any);

        assert.equal(returnedId, 'job-uuid-abc');
        assert.equal(calls.length, 1);
        const call = calls[0] as { name: string; data: CteEmissionJobData; opts?: { jobId?: string } };
        assert.equal(call.name, 'emit');
        assert.deepEqual(call.data, data);
        assert.equal(call.opts?.jobId, 'job-uuid-abc', 'jobId deve ser exatamente o cteEmissionJobId, nunca undefined (que deixaria o BullMQ auto-gerar)');
    });

    it('idempotente: enfileirar 2x com o mesmo cteEmissionJobId não lança e retorna o mesmo id', async () => {
        const { queue } = makeFakeQueue();
        const data: CteEmissionJobData = { calcId: 'calc-2', cteEmissionJobId: 'job-uuid-xyz', phaseHint: 'submit' };

        const first = await enqueueCteEmissionJob(data, queue as any);
        const second = await enqueueCteEmissionJob(data, queue as any);

        assert.equal(first, 'job-uuid-xyz');
        assert.equal(second, 'job-uuid-xyz');
    });

    it('lança erro claro se o BullMQ (real ou fake) devolver job sem id', async () => {
        const queue = { add: mock.fn(async () => ({ id: undefined })) };
        const data: CteEmissionJobData = { calcId: 'calc-3', cteEmissionJobId: 'job-uuid-3' };

        await assert.rejects(
            () => enqueueCteEmissionJob(data, queue as any),
            /BullMQ não retornou id/,
        );
    });
});
