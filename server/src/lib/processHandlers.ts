/** Falha fatal => loga e encerra com código != 0 para o orquestrador reiniciar o processo limpo. */
export function installProcessErrorHandlers(source: string, exit: (code: number) => void = (c) => process.exit(c)): void {
    const fatal = (kind: string) => (err: unknown) => {
        console.error(JSON.stringify({
            level: 'fatal',
            source,
            event: kind,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        }));
        exit(1);
    };
    process.on('unhandledRejection', fatal('unhandledRejection'));
    process.on('uncaughtException', fatal('uncaughtException'));
}
