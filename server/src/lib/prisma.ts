import { PrismaClient } from '@prisma/client';

declare global {
    var prisma: PrismaClient | undefined;
}

/**
 * `DATABASE_URL` não tem `connection_limit`/`pool_timeout` explícitos em nenhum ambiente
 * (docker-compose local, stacks de staging/prod) — o engine do Prisma cai no default
 * (`num_cpus*2+1`), que pode ser pequeno demais num container com poucos vCPUs
 * compartilhado por múltiplos workers BullMQ + a própria API. Um pool pequeno sob
 * concorrência real aumenta a chance de connection reset/timeout sendo confundido com
 * instabilidade de rede. Ajustar aqui (não na URL de cada stack YAML) garante que o limite
 * se aplique em qualquer processo que importe este módulo (API, worker, scripts), sem
 * depender do formato exato do `DATABASE_URL` configurado em cada ambiente.
 */
function buildDatabaseUrl(): string | undefined {
    const base = process.env.DATABASE_URL;
    if (!base) return undefined;
    try {
        const url = new URL(base);
        if (!url.searchParams.has('connection_limit')) {
            url.searchParams.set('connection_limit', process.env.DATABASE_CONNECTION_LIMIT ?? '10');
        }
        if (!url.searchParams.has('pool_timeout')) {
            url.searchParams.set('pool_timeout', process.env.DATABASE_POOL_TIMEOUT ?? '20');
        }
        return url.toString();
    } catch {
        // DATABASE_URL malformado: deixa o Prisma reportar o erro real em vez de mascarar aqui.
        return base;
    }
}

export const prisma = global.prisma || new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: { db: { url: buildDatabaseUrl() } },
});

if (process.env.NODE_ENV !== 'production') {
    global.prisma = prisma;
}

export default prisma;
