import type { Demand, DemandSource, Order } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { isIntakeSource } from './intakeDemandPolicy.js';
import { resolvePayerClient } from './resolvePayerClient.js';
import { parseChaveNfe } from '../../lib/nfeChaveIntake.js';
import type { ParsedNfeCargo } from '../acbr/nfeXmlParser.js';
import { resolveLocalNfeCargo } from './resolveLocalNfeCargo.js';

export interface ConfirmIntakeArrivalInput {
    demandId: string;
    actingRoles: string[];
    actingHubId: string | null | undefined;
    remetentePersonId?: string | null;
    destinatarioPersonId: string;
    freightTerm?: 'CIF' | 'FOB' | 'REDESPACHO';
}

export interface ConfirmIntakeArrivalResult {
    demand: Demand;
    order: Order;
}

export async function confirmIntakeArrival(input: ConfirmIntakeArrivalInput): Promise<ConfirmIntakeArrivalResult> {
    const demand = await prisma.demand.findUnique({
        where: { id: input.demandId },
        include: {
            order: true,
            client: { select: { id: true, personId: true, companyName: true } },
        },
    });

    if (!demand) {
        throw new AppError('Demand not found', 404);
    }
    if (demand.status !== 'AWAITING_ARRIVAL') {
        throw new AppError('Demanda não está aguardando chegada', 400);
    }
    if (demand.order) {
        throw new AppError('Pedido já existe para esta demanda', 400);
    }
    if (!isIntakeSource(demand.sourceType as DemandSource)) {
        throw new AppError('Not an intake demand', 400);
    }

    let cargoData = (demand.rawInputData as { nfeXmlData?: ParsedNfeCargo } | null)?.nfeXmlData;
    if (demand.sourceType === 'DFE_ACBR' && !cargoData) {
        const local = await resolveLocalNfeCargo(demand.id);
        if (local.status !== 'available') {
            throw new AppError(local.reason, 409);
        }
        cargoData = local.cargo;
    }

    const isHub = input.actingRoles.includes('HUB');
    if (isHub) {
        if (!input.actingHubId) {
            throw new AppError('Hub user has no hub assigned', 403);
        }
        if (demand.expectedHubId !== input.actingHubId) {
            throw new AppError('Not authorized', 403);
        }
    }

    const remetentePersonId = input.remetentePersonId?.trim() || demand.client?.personId;
    if (!remetentePersonId) {
        throw new AppError(
            'Associe uma pessoa ao cliente ou informe remetentePersonId para confirmar a chegada.',
            400,
        );
    }

    const currentHubId = isHub ? input.actingHubId! : demand.expectedHubId;
    if (!currentHubId) {
        throw new AppError('Defina o hub de recebimento (expectedHubId) antes de confirmar.', 400);
    }

    const freightTerm = input.freightTerm ?? 'CIF';

    const matchingOpportunity = await prisma.opportunity.findFirst({
        where: { matchedDemandId: demand.id },
    });

    // Início/fim de prestação (campos fiscais do CT-e — cidade pura, não texto livre) vêm do
    // Person vinculado quando ele já tem cidade resolvida contra o catálogo (`resolveIbgeCode`
    // em `persons.ts`) — mais confiável e mais atual que `demand.origin`/`destination`, que
    // ficam congelados desde a criação da Demand e podem trazer "razão social - cidade, UF"
    // (formato pensado pro card de listagem, não pro campo fiscal). Cai pro texto da Demand só
    // quando o Person não tem cidade (fluxos MANUAL_HUB/DECLARATION sem cargoData).
    const prestacaoPersons = await prisma.person.findMany({
        where: { id: { in: [remetentePersonId, input.destinatarioPersonId] } },
        select: { id: true, city: true, state: true, cityIbgeCode: true },
    });
    const remetentePersonRecord = prestacaoPersons.find((p) => p.id === remetentePersonId);
    const destinatarioPersonRecord = prestacaoPersons.find((p) => p.id === input.destinatarioPersonId);

    const origemPrestacao =
        remetentePersonRecord?.city && remetentePersonRecord?.state
            ? `${remetentePersonRecord.city}, ${remetentePersonRecord.state}`
            : demand.origin;
    const origemIbgeCode = remetentePersonRecord?.cityIbgeCode ?? null;

    const fimPrestacao =
        destinatarioPersonRecord?.city && destinatarioPersonRecord?.state
            ? `${destinatarioPersonRecord.city}, ${destinatarioPersonRecord.state}`
            : demand.destination;
    const fimIbgeCode = destinatarioPersonRecord?.cityIbgeCode ?? null;

    // Notas Fiscais: espelha o que o formulário manual (OrderNFForm.tsx) grava via
    // POST /orders/:id/invoices — construído automaticamente a partir do que a varredura da
    // NF-e já leu, pra não obrigar o humano a redigitar chave/número/peso/valor que o sistema
    // já tem. Chave/número/emissão vêm só da própria chave (sempre confiáveis, não dependem de
    // XML baixado); peso/volumes/valor/natureza só quando o XML já baixou (cargoData) — sem
    // isso, ficam no default do schema (0/undefined), igual ao que já acontece hoje na Demand.
    const parsedChave = demand.documentKey ? parseChaveNfe(demand.documentKey) : null;
    const orderInvoiceData =
        demand.documentType === 'NFE' && demand.documentKey
            ? {
                  type: 'NFE' as const,
                  nfNumber: demand.nfNumber,
                  nfKey: demand.documentKey,
                  ...(parsedChave ? { emissionDate: new Date(parsedChave.emissionDate) } : {}),
                  ...(cargoData?.produtos?.[0]?.descricao ? { nature: cargoData.produtos[0].descricao } : {}),
                  volumes: cargoData?.quantidadeVolumes ?? 0,
                  weight: cargoData?.pesoBruto ?? cargoData?.pesoLiquido ?? 0,
                  value: cargoData?.valorTotalNota ?? 0,
              }
            : null;

    // Cliente (conta faturável) só se resolve agora — quando o frete/pagador é decidido — e
    // nunca bloqueia: se o pagador não estiver cadastrado como Client, a Demand segue sem
    // clientId (ver `resolvePayerClient.ts`). REDESPACHO usa o destinatário como proxy do
    // consignatário porque este fluxo não recebe `consignatarioPersonId`.
    const payerResolution = demand.clientId
        ? null
        : await resolvePayerClient({
              freightTerm,
              remetentePersonId,
              destinatarioPersonId: input.destinatarioPersonId,
          });

    return prisma.$transaction(async (tx) => {
        const updatedDemand = await tx.demand.update({
            where: { id: demand.id },
            data: {
                status: 'CONVERTED',
                ...(payerResolution?.client ? { clientId: payerResolution.client.id } : {}),
            },
        });

        await tx.demandEvent.create({
            data: {
                demandId: demand.id,
                status: 'CONVERTED',
                description: 'Chegada confirmada no hub — pedido criado',
                location: demand.origin,
            },
        });

        const newOrder = await tx.order.create({
            data: {
                demandId: demand.id,
                opportunityId: matchingOpportunity?.id ?? null,
                manifestId: undefined,
                nfNumber: demand.nfNumber,
                status: 'AT_HUB',
                enteredAtHubAt: new Date(),
                currentHubId,
                freightTerm,
                remetentePersonId,
                destinatarioPersonId: input.destinatarioPersonId,
                origemPrestacao,
                origemIbgeCode,
                fimPrestacao,
                fimIbgeCode,
                ...(orderInvoiceData ? { invoicesRel: { create: orderInvoiceData } } : {}),
            },
        });

        const demandEvents = await tx.demandEvent.findMany({
            where: { demandId: demand.id },
            orderBy: { createdAt: 'asc' },
        });

        const statusMap: Record<string, string> = {
            PENDING: 'CREATED',
            QUOTED: 'CREATED',
            APPROVED: 'CREATED',
            ASSIGNED: 'CREATED',
            AWAITING_ARRIVAL: 'CREATED',
            COLLECTED: 'COLLECTED',
            IN_TRANSIT: 'IN_TRANSIT',
            AT_HUB: 'AT_HUB',
            OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
            DELIVERED: 'DELIVERED',
            CANCELLED: 'CANCELLED',
        };

        for (const event of demandEvents) {
            await tx.orderHistory.create({
                data: {
                    orderId: newOrder.id,
                    eventType: (statusMap[event.status] || 'NOTE') as any,
                    description: event.description,
                    location: event.location,
                    photoUrl: event.photoUrl,
                    demandEventId: event.id,
                },
            });
        }

        await tx.orderHistory.create({
            data: {
                orderId: newOrder.id,
                eventType: 'AT_HUB',
                description: 'Chegada confirmada no hub (intake)',
                location: demand.origin,
            },
        });

        return { demand: updatedDemand, order: newOrder };
    });
}
