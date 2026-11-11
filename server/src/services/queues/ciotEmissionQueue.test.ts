import assert from 'node:assert/strict';
import { it } from 'node:test';
import { enqueueCiotEmissionJob } from './ciotEmissionQueue.js';

it('reexecuta o ID de uma tentativa concluída, sem remover job ativo', async () => {
    for (const state of ['completed', 'failed', 'active', 'waiting']) {
        const calls: string[] = [];
        const queue: any = { getJob: async () => ({ getState: async () => state, remove: async () => { calls.push('remove'); } }), add: async (_: string, data: any, options: any) => { calls.push('add'); assert.equal(options.jobId, data.ciotEmissionJobId); return { id: options.jobId }; } };
        assert.equal(await enqueueCiotEmissionJob({ ciotEmissionJobId: 'original-id' }, queue), 'original-id');
        assert.deepEqual(calls, ['completed', 'failed'].includes(state) ? ['remove', 'add'] : ['add']);
    }
});
