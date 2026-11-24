/**
 * Alerta de operação para fora do sistema (n8n/WhatsApp/e-mail/Slack via webhook).
 *
 * O `SystemAlert` só aparece na tela; à noite ninguém está olhando. Isto empurra o que exige ação
 * humana imediata: erro 500 da API, queda de processo (api/worker) e `SystemAlert` CRITICAL
 * (ex.: fila de CT-e pausada por cota do provedor).
 *
 * - Desligado sem `OPS_ALERT_WEBHOOK_URL` (dev/test).
 * - Nunca lança: falha do webhook vai só para o log (alerta não pode derrubar operação).
 * - Agrupa repetição: a mesma `key` só dispara 1x por janela (padrão 10 min), com contagem.
 * - Não leva corpo de requisição nem dado pessoal: título curto + detalhe técnico.
 */
export type OpsAlertSeverity = 'WARNING' | 'CRITICAL';

export interface OpsAlert {
    severity: OpsAlertSeverity;
    source: string;
    title: string;
    detail?: string;
    /** Chave de agrupamento; padrão `source:title`. */
    key?: string;
    context?: Record<string, unknown>;
}

type Env = Record<string, string | undefined>;
type Poster = (url: string, body: string, headers: Record<string, string>) => Promise<{ ok: boolean; status: number }>;

const defaultPoster: Poster = async (url, body, headers) => {
    const res = await fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(5000) });
    return { ok: res.ok, status: res.status };
};

const lastSent = new Map<string, { at: number; suppressed: number }>();

export function resetOpsAlertStateForTests(): void {
    lastSent.clear();
}

export async function notifyOps(alert: OpsAlert, env: Env = process.env, post: Poster = defaultPoster): Promise<boolean> {
    const url = env.OPS_ALERT_WEBHOOK_URL?.trim();
    if (!url) return false;

    const windowMs = Number.parseInt(env.OPS_ALERT_DEDUP_MS ?? '', 10) || 10 * 60 * 1000;
    const key = alert.key ?? `${alert.source}:${alert.title}`;
    const now = Date.now();
    const prev = lastSent.get(key);
    if (prev && now - prev.at < windowMs) {
        prev.suppressed += 1;
        return false;
    }
    const suppressed = prev?.suppressed ?? 0;
    lastSent.set(key, { at: now, suppressed: 0 });

    const environment = env.OPS_ALERT_ENVIRONMENT?.trim() || env.NODE_ENV || 'unknown';
    const body = JSON.stringify({
        environment,
        severity: alert.severity,
        source: alert.source,
        title: alert.title,
        detail: alert.detail?.slice(0, 2000),
        context: alert.context,
        suppressedSinceLast: suppressed,
        at: new Date(now).toISOString(),
        text: `[${environment}] ${alert.severity === 'CRITICAL' ? '🔴' : '🟠'} ${alert.title}${alert.detail ? ` — ${alert.detail.slice(0, 300)}` : ''}`,
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = env.OPS_ALERT_WEBHOOK_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
        const res = await post(url, body, headers);
        if (!res.ok) console.error(JSON.stringify({ level: 'error', type: 'ops-alert', event: 'webhook_failed', status: res.status, key }));
        return res.ok;
    } catch (err) {
        console.error(JSON.stringify({ level: 'error', type: 'ops-alert', event: 'webhook_error', error: err instanceof Error ? err.message : String(err), key }));
        return false;
    }
}
