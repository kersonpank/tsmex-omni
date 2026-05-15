/**
 * Smoke PR002 — Entrada universal (intake Demand).
 * Pré-requisitos: migrate deploy, seed (inclui hub.spgru + pessoas entrada), API rodando.
 *
 * Uso:
 *   BASE_URL=http://localhost:3002/api node scripts/smoke-pr002-intake.mjs
 *
 * Credenciais padrão alinhadas ao seed.ts
 */
const BASE = (process.env.BASE_URL || 'http://localhost:3002/api').replace(/\/$/, '');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@tsmex.com';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const HUB_EMAIL = process.env.HUB_EMAIL || 'hub.spgru@tsmex.com';
const HUB_PASS = process.env.HUB_PASS || 'hub123';
const CLIENT_EMAIL = process.env.CLIENT_EMAIL || 'cliente@exemplo.com';
const CLIENT_PASS = process.env.CLIENT_PASS || 'cliente123';

/** 44 dígitos, modelo 55 nas posições 21–22 (índices 20–21) */
const CHAVE_NFE_SMOKE =
    process.env.CHAVE_NFE_SMOKE || '35250112345678000190550010000000000123456789';

const log = (...a) => console.log(...a);
const section = (n, title) => log(`\n========== ${n}. ${title} ==========`);

const fetchTimeoutMs = Number(process.env.SMOKE_FETCH_TIMEOUT_MS || 8000);

async function fetchWithTimeout(url, options = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), fetchTimeoutMs);
    try {
        return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
        clearTimeout(t);
    }
}

function fail(msg) {
    console.error(`\n❌ SMOKE FALHOU: ${msg}\n`);
    process.exit(1);
}

async function login(email, password) {
    const r = await fetchWithTimeout(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) fail(`login ${email}: HTTP ${r.status} ${JSON.stringify(j)}`);
    const token = j?.data?.token;
    if (!token) fail(`login ${email}: token ausente`);
    return token;
}

async function req(method, path, { token, body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetchWithTimeout(`${BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        json = { _raw: text };
    }
    return { status: r.status, json };
}

async function main() {
    log(`BASE_URL = ${BASE}`);
    section(0, 'Health');
    const origin = BASE.replace(/\/api$/, '');
    let h2;
    try {
        h2 = await fetchWithTimeout(`${origin}/health`);
    } catch (e) {
        fail(`API não respondeu em /health (${e instanceof Error ? e.message : e}). Suba o server (PORT alinhado ao BASE_URL).`);
    }
    log(`GET /health → HTTP ${h2.status}`);
    if (!h2.ok) fail('API não respondeu em /health. Suba o server e tente de novo.');

    const adminTok = await login(ADMIN_EMAIL, ADMIN_PASS);
    const hubTok = await login(HUB_EMAIL, HUB_PASS);
    const clientTok = await login(CLIENT_EMAIL, CLIENT_PASS);

    const me = await req('GET', '/auth/me', { token: clientTok });
    const clientId = me.json?.data?.client?.id;
    if (!clientId) fail('Cliente seed: GET /auth/me sem client.id');

    const hubsRes = await req('GET', '/hubs', { token: adminTok });
    const hubList = hubsRes.json?.data || [];
    const hubSp = hubList.find((h) => h.code === 'SP-GRU');
    const hubOther = hubList.find((h) => h.code === 'IMP-MA') || hubList.find((h) => h.id !== hubSp?.id);
    if (!hubSp?.id || !hubOther?.id) fail('Precisa de pelo menos 2 hubs no seed (SP-GRU e outro)');

    const personsRes = await req('GET', '/persons', { token: adminTok });
    const persons = personsRes.json?.data || [];
    const remet = persons.find((p) => p.document === '12345678000190');
    const dest = persons.find((p) => p.document === '98765432000199');
    if (!remet?.id || !dest?.id)
        fail('Pessoas 12345678000190 / 98765432000199 não encontradas — rode prisma db seed');

    const suffix = `-${Date.now()}`;

    // 1–3 Manual + GET + sem order
    section('1–3', 'POST intake manual AWAITING_ARRIVAL + GET sem Order');
    const manualBody = {
        sourceType: 'MANUAL_HUB',
        clientId,
        expectedHubId: hubSp.id,
        origin: 'São Paulo, SP',
        destination: 'Rio de Janeiro, RJ',
        commodity: 'Peças',
        nfNumber: `SMK-001${suffix}`,
        nfValue: 1000,
        weight: 12,
        volume: 0.5,
    };
    let r = await req('POST', '/intake/demands', { token: adminTok, body: manualBody });
    log(`POST /intake/demands (manual) HTTP ${r.status}`, JSON.stringify(r.json).slice(0, 400));
    if (r.status !== 201) fail('manual intake esperado 201');
    const dManual = r.json?.data;
    if (dManual?.status !== 'AWAITING_ARRIVAL') fail('manual: status deve ser AWAITING_ARRIVAL');
    if (dManual?.order != null) fail('manual: order deve ser ausente');

    r = await req('GET', `/intake/demands/${dManual.id}`, { token: adminTok });
    log(`GET /intake/demands/:id HTTP ${r.status}`);
    if (r.status !== 200) fail('GET intake demand');
    const orderInline = r.json?.data?.order;
    if (orderInline != null) fail('GET intake: order deve ser null/absente');

    // 4 Declaração
    section(4, 'POST intake DECLARATION');
    r = await req('POST', '/intake/demands', {
        token: adminTok,
        body: {
            sourceType: 'DECLARATION',
            clientId,
            declarationData: { description: 'Roupas usadas', value: 250 },
            origin: 'Curitiba, PR',
            destination: 'Florianópolis, SC',
            commodity: 'Roupas',
            nfNumber: `DECL-1${suffix}`,
            nfValue: 250,
            weight: 5,
            volume: 0.2,
        },
    });
    log(`HTTP ${r.status}`, r.json?.data?.sourceType, r.json?.data?.documentType, r.json?.data?.status);
    if (r.status !== 201 || r.json?.data?.sourceType !== 'DECLARATION') fail('declaração');
    if (r.json?.data?.status !== 'AWAITING_ARRIVAL') fail('declaração status');

    // 5–6 Chave NF-e + idempotência
    section('5–6', 'POST from-nfe-key + missingFields + segunda chamada mesmo id');
    const chave44 = CHAVE_NFE_SMOKE.replace(/\D/g, '');
    if (chave44.length !== 44) fail(`CHAVE_NFE_SMOKE deve ter 44 dígitos, tem ${chave44.length}`);

    r = await req('POST', '/intake/demands/from-nfe-key', {
        token: adminTok,
        body: { chave: chave44, clientId },
    });
    log(`POST from-nfe-key HTTP ${r.status}`);
    if (r.status !== 201) fail(`from-nfe-key ${JSON.stringify(r.json)}`);
    const dNfe = r.json?.data;
    const mf = dNfe?.missingFields;
    if (!Array.isArray(mf) || mf.length === 0) fail('missingFields deve vir preenchido');
    if (!dNfe?.documentKey) fail('documentKey obrigatório');
    if (dNfe?.status !== 'AWAITING_ARRIVAL') fail('nfe status');

    r = await req('POST', '/intake/demands/from-nfe-key', {
        token: adminTok,
        body: { chave: chave44, clientId },
    });
    log(`POST from-nfe-key (2ª) HTTP ${r.status} id=${r.json?.data?.id}`);
    if (r.status !== 201) fail('segunda chave');
    if (r.json?.data?.id !== dNfe.id) fail('idempotência: mesmo demand id');

    // 7–8 Listagem Hub vs Admin
    section('7–8', 'GET /intake/demands isolamento hub + admin');
    const idOtherHub = hubOther.id;
    r = await req('POST', '/intake/demands', {
        token: adminTok,
        body: {
            sourceType: 'MANUAL_HUB',
            clientId,
            expectedHubId: idOtherHub,
            origin: 'X',
            destination: 'Y',
            commodity: 'Z',
            nfNumber: `OTHER-HUB${suffix}`,
            nfValue: 1,
            weight: 1,
            volume: 0.001,
        },
    });
    if (r.status !== 201) fail('criar intake outro hub');
    const demandOtherB = r.json?.data?.id;

    r = await req('GET', '/intake/demands', { token: hubTok });
    const hubIds = (r.json?.data || []).map((d) => d.id);
    log(`HUB lista total ${hubIds.length}`);
    if (hubIds.includes(demandOtherB))
        fail('HUB SP-GRU não deveria ver demand com expectedHubId de outro CD');

    r = await req('GET', '/intake/demands', { token: adminTok });
    const adminIds = (r.json?.data || []).map((d) => d.id);
    if (!adminIds.includes(demandOtherB)) fail('Admin deveria ver demand do outro hub');
    r = await req('GET', `/intake/demands?expectedHubId=${encodeURIComponent(idOtherHub)}`, {
        token: adminTok,
    });
    const filt = (r.json?.data || []).map((d) => d.id);
    if (!filt.includes(demandOtherB)) fail('Admin filtro expectedHubId');

    // 9–10 PATCH AT_HUB
    section('9–10', 'PATCH /demands/:id/status AT_HUB (admin = intake 403)');
    r = await req('PATCH', `/demands/${dManual.id}/status`, {
        token: hubTok,
        body: { status: 'AT_HUB' },
    });
    log(`PATCH como HUB HTTP ${r.status} msg=${r.json?.message || r.json?.error}`);
    if (r.status !== 403) fail('HUB deveria receber 403 antes do guard intake');
    const hubMsg = String(r.json?.message || '');
    if (!hubMsg.includes('order status')) fail('HUB: mensagem esperada sobre order status');

    r = await req('PATCH', `/demands/${dManual.id}/status`, {
        token: adminTok,
        body: { status: 'AT_HUB' },
    });
    log(`PATCH como ADMIN HTTP ${r.status} msg=${r.json?.message || r.json?.error}`);
    if (r.status !== 403) fail('Admin intake deveria bloquear AT_HUB sem Order');
    const admMsg = String(r.json?.message || '');
    if (!/confirm-arrival/i.test(admMsg)) fail('Admin: mensagem deve citar confirm-arrival');

    // 11 Legado entrada
    section(11, 'POST /orders/entrada → Demand + Order');
    r = await req('POST', '/orders/entrada', {
        token: adminTok,
        body: {
            freightTerm: 'CIF',
            remetentePersonId: remet.id,
            destinatarioPersonId: dest.id,
            origemPrestacao: 'Campinas, SP',
            fimPrestacao: 'Recife, PE',
        },
    });
    log(`HTTP ${r.status}`);
    if (r.status !== 201) fail(`entrada ${JSON.stringify(r.json)}`);
    const ordId = r.json?.data?.id;
    const demIdEntrada = r.json?.data?.demandId;
    if (!ordId || !demIdEntrada) fail('entrada: order e demandId');

    // 12 /demands/pending sem AWAITING_ARRIVAL
    section(12, 'GET /demands/pending sem AWAITING_ARRIVAL');
    r = await req('GET', '/demands/pending', { token: adminTok });
    const pending = r.json?.data || [];
    const bad = pending.filter((d) => d.status === 'AWAITING_ARRIVAL');
    log(`pending count=${pending.length} awaiting=${bad.length}`);
    if (bad.length > 0) fail('pending não deve listar AWAITING_ARRIVAL');

    log('\n✅ Smoke PR002 intake concluído com sucesso.\n');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
