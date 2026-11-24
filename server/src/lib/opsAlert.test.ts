import assert from 'node:assert/strict';
import test from 'node:test';
import { notifyOps, resetOpsAlertStateForTests } from './opsAlert.js';

test('sem URL não envia nada', async () => {
    resetOpsAlertStateForTests();
    let called = 0;
    const sent = await notifyOps({ severity: 'CRITICAL', source: 'api', title: 'x' }, {}, async () => { called++; return { ok: true, status: 200 }; });
    assert.equal(sent, false);
    assert.equal(called, 0);
});

test('envia com token, agrupa repetição na janela e conta as suprimidas', async () => {
    resetOpsAlertStateForTests();
    const bodies: any[] = [];
    let auth = '';
    const post = async (_u: string, body: string, headers: Record<string, string>) => { bodies.push(JSON.parse(body)); auth = headers.Authorization; return { ok: true, status: 200 }; };
    const env = { OPS_ALERT_WEBHOOK_URL: 'https://hook.test/x', OPS_ALERT_WEBHOOK_TOKEN: 't0k', OPS_ALERT_ENVIRONMENT: 'producao', OPS_ALERT_DEDUP_MS: '50' };
    assert.equal(await notifyOps({ severity: 'CRITICAL', source: 'worker', title: 'Fila de CT-e pausada' }, env, post), true);
    assert.equal(await notifyOps({ severity: 'CRITICAL', source: 'worker', title: 'Fila de CT-e pausada' }, env, post), false);
    assert.equal(await notifyOps({ severity: 'CRITICAL', source: 'worker', title: 'Fila de CT-e pausada' }, env, post), false);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(await notifyOps({ severity: 'CRITICAL', source: 'worker', title: 'Fila de CT-e pausada' }, env, post), true);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].suppressedSinceLast, 2);
    assert.equal(auth, 'Bearer t0k');
    assert.match(bodies[0].text, /^\[producao\] 🔴 Fila de CT-e pausada/);
});

test('falha do webhook não lança', async () => {
    resetOpsAlertStateForTests();
    const ok = await notifyOps({ severity: 'WARNING', source: 'api', title: 'y' }, { OPS_ALERT_WEBHOOK_URL: 'https://hook.test' }, async () => { throw new Error('timeout'); });
    assert.equal(ok, false);
});
