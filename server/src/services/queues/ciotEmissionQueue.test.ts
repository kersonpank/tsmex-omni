import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enqueueCiotEmissionJob } from './ciotEmissionQueue.js';

function fakeQueue(state: string | null) {
    const calls: string[] = [];
    const queue: any = {
        getJob: async () => (state === null ? undefined : {
            getState: async () => state,
            remove: async () => { calls.push('remove'); },
        }),
        add: async (_name: string, data: any, options: any) => {
            calls.push('add');
            assert.equal(options.jobId, data.ciotEmissionJobId);
            return { id: options.jobId };
        },
    };
    return { queue, calls };
}

describe('enqueueCiotEmissionJob', () => {
    for (const state of ['completed', 'failed']) {
        it(`remove a tentativa ${state} antes de reenfileirar o mesmo id`, async () => {
            const { queue, calls } = fakeQueue(state);
            assert.equal(await enqueueCiotEmissionJob({ ciotEmissionJobId: 'job-1' }, queue), 'job-1');
            assert.deepEqual(calls, ['remove', 'add']);
        });
    }

    for (const state of ['active', 'waiting', 'delayed']) {
        it(`não remove job ${state}`, async () => {
            const { queue, calls } = fakeQueue(state);
            await enqueueCiotEmissionJob({ ciotEmissionJobId: 'job-1' }, queue);
            assert.deepEqual(calls, ['add']);
        });
    }

    it('enfileira normalmente quando o id nunca existiu', async () => {
        const { queue, calls } = fakeQueue(null);
        await enqueueCiotEmissionJob({ ciotEmissionJobId: 'job-1' }, queue);
        assert.deepEqual(calls, ['add']);
    });
});
