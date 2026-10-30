import { persistDerivedCteCfop } from '../fiscal/cteCfopPersistence.js';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import type { CteEmissionInput } from '../cteService.js';
import type { FiscalEmitterContext } from '../acbr/acbrCteEmit.js';
import { buildCteEmissionInputFromRecords } from '../fiscal/cteEmissionInputBuilder.js';

export async function buildCteEmissionInputForJob(calcId: string, emissionJobId?: string): Promise<{
    input: CteEmissionInput;
    fiscalEmitterContext: FiscalEmitterContext | null;
}> {
    const calc = await prisma.orderFreightCalculation.findUniqueOrThrow({
        where: { id: calcId },
        include: {
            fiscalEmitter: { include: { person: true, hub: true } },
            order: {
                include: {
                    remetentePerson: true,
                    destinatarioPerson: true,
                    consignatarioPerson: true,
                    expedidorPerson: true,
                    invoicesRel: true,
                },
            },
        },
    });
    const hub = await prisma.hub.findUniqueOrThrow({ where: { id: calc.emissorId }, include: { person: true } });

    const job = emissionJobId
        ? await prisma.cteEmissionJob.findFirst({ where: { id: emissionJobId, calcId }, select: { inputSnapshot: true } })
        : null;
    if (emissionJobId && !job) throw new AppError('Tentativa de emissão não encontrada para este cálculo.', 404);
    let input: CteEmissionInput;
    if (job?.inputSnapshot) {
        const snapshot = job.inputSnapshot as unknown as CteEmissionInput;
        if (!snapshot?.calc || !snapshot.order || !snapshot.person || !snapshot.hub ||
            !['HOMOLOGACAO', 'PRODUCAO'].includes(snapshot.ambiente)) {
            throw new AppError('Dados preservados da tentativa de CT-e estão incompletos.', 400);
        }
        input = snapshot;
    } else {
        // Compatibilidade apenas para jobs criados antes da migração.
        const built = buildCteEmissionInputFromRecords({
            order: calc.order,
            calc,
            hub,
            numero: calc.cteNumber ? Number(calc.cteNumber) : undefined,
        });
        if (!built.preflight.ok || !built.input) {
            throw new AppError(`CT-e com pendências fiscais no momento do processamento: ${built.preflight.issues.join(' ')}`, 400);
        }
        input = built.input;
        if (calc.cfop !== input.calc.cfop) {
            await prisma.$transaction(async (tx) => persistDerivedCteCfop(tx, calc, input));
        }
    }

    const fiscalEmitterContext: FiscalEmitterContext | null = calc.fiscalEmitter
        ? {
              crt: calc.fiscalEmitter.crt,
              environment: input.ambiente,
              certificateStorageKey: calc.fiscalEmitter.certificateStorageKey,
              certificatePasswordEncrypted: calc.fiscalEmitter.certificatePasswordEncrypted,
          }
        : null;

    return { input, fiscalEmitterContext };
}
