import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';

export interface FreightAgreementInput {
    freteBruto: number;
    adiantamento?: number;
    pedagio?: number;
    irrf?: number;
    inss?: number;
    issqn?: number;
    sestSenat?: number;
    outrosDescontos?: number;
    outrosDescontosDescricao?: string;
}

/**
 * saldoLiquido = quanto o motorista/transportador ainda vai receber: frete bruto acordado,
 * menos o que já foi adiantado, menos retenções (IR/INSS/ISSQN/SestSenat) e outros descontos.
 * É o valor de referência para acerto/pagamento (Fatia 3) — NÃO é o custo total da viagem para
 * a TSM (esse é freteBruto + pedágio; ver calculateLinkCost em pricingService.ts).
 */
export function calculateSaldoLiquido(input: FreightAgreementInput): number {
    const adiantamento = input.adiantamento ?? 0;
    const pedagio = input.pedagio ?? 0;
    const irrf = input.irrf ?? 0;
    const inss = input.inss ?? 0;
    const issqn = input.issqn ?? 0;
    const sestSenat = input.sestSenat ?? 0;
    const outrosDescontos = input.outrosDescontos ?? 0;
    return input.freteBruto + pedagio - adiantamento - irrf - inss - issqn - sestSenat - outrosDescontos;
}

export async function upsertFreightAgreement(
    manifestId: string,
    input: FreightAgreementInput,
    tx: Prisma.TransactionClient = prisma
) {
    const saldoLiquido = calculateSaldoLiquido(input);
    const data = {
        freteBruto: input.freteBruto,
        adiantamento: input.adiantamento ?? 0,
        pedagio: input.pedagio ?? 0,
        irrf: input.irrf ?? 0,
        inss: input.inss ?? 0,
        issqn: input.issqn ?? 0,
        sestSenat: input.sestSenat ?? 0,
        outrosDescontos: input.outrosDescontos ?? 0,
        outrosDescontosDescricao: input.outrosDescontosDescricao,
        saldoLiquido,
    };
    return tx.manifestFreightAgreement.upsert({
        where: { manifestId },
        create: { manifestId, ...data },
        update: data,
    });
}
