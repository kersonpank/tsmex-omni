import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import type { CteEmissionInput } from '../cteService.js';
import type { FiscalEmitterContext } from '../acbr/acbrCteEmit.js';
import { buildCteEmissionInputFromRecords } from '../fiscal/cteEmissionInputBuilder.js';

export async function buildCteEmissionInputForJob(calcId: string): Promise<{
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

    const { input, preflight } = buildCteEmissionInputFromRecords({
        order: calc.order,
        calc,
        hub,
        numero: calc.cteNumber ? Number(calc.cteNumber) : undefined,
    });
    if (!preflight.ok || !input) {
        throw new AppError(`CT-e com pendências fiscais no momento do processamento: ${preflight.issues.join(' ')}`, 400);
    }

    const fiscalEmitterContext: FiscalEmitterContext | null = calc.fiscalEmitter
        ? {
              crt: calc.fiscalEmitter.crt,
              environment: calc.fiscalEmitter.environment as 'HOMOLOGACAO' | 'PRODUCAO',
              certificateStorageKey: calc.fiscalEmitter.certificateStorageKey,
              certificatePasswordEncrypted: calc.fiscalEmitter.certificatePasswordEncrypted,
          }
        : null;

    return { input, fiscalEmitterContext };
}
