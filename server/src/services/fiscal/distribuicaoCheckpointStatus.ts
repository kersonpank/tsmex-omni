import prisma from '../../lib/prisma.js';

export type DistribuicaoAmbiente = 'homologacao' | 'producao';

export interface DistribuicaoCheckpointStatus {
    ambiente: DistribuicaoAmbiente;
    ultimoNsu: string;
    /** `false` sempre que não há linha ou `ultimoNsu === '0'` — mesmo critério usado pelas
     * guardas de `distribuicaoNfeCoordinatorProcessor.ts`/`distribuicaoNfeSyncProcessor.ts`. */
    seeded: boolean;
}

function keyFor(cpfCnpj: string, ambiente: DistribuicaoAmbiente): string {
    return `${cpfCnpj}|${ambiente}`;
}

function toStatus(ambiente: DistribuicaoAmbiente, ultimoNsu: string | undefined): DistribuicaoCheckpointStatus {
    const value = ultimoNsu ?? '0';
    return { ambiente, ultimoNsu: value, seeded: value !== '0' };
}

/** Status do checkpoint pra 1 CNPJ+ambiente — usado pelos endpoints de 1 emitente (`GET /:id`, `POST /`, `PATCH /:id`). */
export async function getDistribuicaoCheckpointStatus(
    cpfCnpj: string,
    ambiente: DistribuicaoAmbiente,
): Promise<DistribuicaoCheckpointStatus> {
    const row = await prisma.fiscalDistribuicaoCheckpoint.findUnique({
        where: { cpfCnpj_ambiente: { cpfCnpj, ambiente } },
    });
    return toStatus(ambiente, row?.ultimoNsu);
}

/**
 * Mesma coisa em lote — evita N+1 na listagem (`GET /`), que hoje já carrega todos os emitentes
 * numa única query e não deveria virar 1 SELECT extra por linha só pra saber se está semeado.
 */
export async function getDistribuicaoCheckpointStatusBatch(
    pairs: Array<{ cpfCnpj: string; ambiente: DistribuicaoAmbiente }>,
): Promise<Map<string, DistribuicaoCheckpointStatus>> {
    const unique = new Map<string, { cpfCnpj: string; ambiente: DistribuicaoAmbiente }>();
    for (const p of pairs) unique.set(keyFor(p.cpfCnpj, p.ambiente), p);

    const result = new Map<string, DistribuicaoCheckpointStatus>();
    if (unique.size === 0) return result;

    const rows = await prisma.fiscalDistribuicaoCheckpoint.findMany({
        where: { OR: Array.from(unique.values()) },
    });
    const rowByKey = new Map(rows.map((r) => [keyFor(r.cpfCnpj, r.ambiente as DistribuicaoAmbiente), r]));

    for (const [key, p] of unique) {
        const row = rowByKey.get(key);
        result.set(key, toStatus(p.ambiente, row?.ultimoNsu));
    }
    return result;
}

export function distribuicaoCheckpointKey(cpfCnpj: string, ambiente: DistribuicaoAmbiente): string {
    return keyFor(cpfCnpj, ambiente);
}
