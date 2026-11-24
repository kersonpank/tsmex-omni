import { notifyOps } from './opsAlert.js';

/**
 * Falha fatal => loga, avisa a operação (webhook, no máximo ~3 s) e encerra com código != 0 para o
 * orquestrador reiniciar o processo limpo.
 */
export function installProcessErrorHandlers(
    source: string,
    exit: (code: number) => void = (c) => process.exit(c),
    alert: typeof notifyOps = notifyOps,
): void {
    let exiting = false;
    const fatal = (kind: string) => (err: unknown) => {
        if (exiting) return;
        exiting = true;
        console.error(JSON.stringify({
            level: 'fatal',
            source,
            event: kind,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        }));
        const message = err instanceof Error ? err.message : String(err);
        const timer = new Promise((r) => setTimeout(r, 3000).unref());
        void Promise.race([
            alert({ severity: 'CRITICAL', source, title: `Processo ${source} caiu (${kind})`, detail: message }),
            timer,
        ]).finally(() => exit(1));
    };
    process.on('unhandledRejection', fatal('unhandledRejection'));
    process.on('uncaughtException', fatal('uncaughtException'));
}
