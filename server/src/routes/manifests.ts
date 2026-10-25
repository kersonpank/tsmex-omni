import { validateSelectedAddress } from '../services/selectedCity.js';
import { freightDocState, type FreightDocState } from '../services/freight/freightDocRules.js';
import { selectedManifestCity } from '../services/manifestSelectedCity.js';
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { isAcbrCredentialsConfigured } from '../services/acbr/acbrConfig.js';
import { emitMdfeViaAcbr, reconcileMdfeDocument } from '../services/acbr/acbrMdfeEmit.js';
import { getManifestMargin } from '../services/pricingService.js';
import { upsertFreightAgreement } from '../services/manifestFreightAgreementService.js';
import { getManifestTripPriceEstimate } from '../services/manifestTripPriceEstimateService.js';
import { isEfreteCredentialsConfigured } from '../services/efrete/efreteConfig.js';
import { suggestCiotTipoViagem } from '../services/efrete/ciotTipoViagemRule.js';
import { cancelarCiot } from '../services/efrete/efreteCiotEmit.js';
import { getObjectDownloadUrl } from '../lib/objectStorage.js';
import { enqueueCiotEmissionJob } from '../services/queues/ciotEmissionQueue.js';
import type { StoredCiotRequestData } from '../services/queues/ciotEmissionJobInput.js';
import { getManifestReadiness } from '../services/manifestReadinessService.js';
import { dispenseManifestCiot, undoManifestCiotDispensa } from '../services/manifestCiotDispensa.js';
import { createManifestDraft } from '../services/manifestCreate.js';
import { manifestVehiclesSchema, setManifestVehicles, publishManifestOffer } from '../services/manifestVehicleService.js';
import { cancelManifest, deleteEmptyManifest, getPlanningActions, reopenAcceptedManifest, requestManifestCorrection, resolveManifestCorrection } from '../services/manifestPlanningChanges.js';
import { listManifestDeliveryProgress, recordDeliveryAttempt } from '../services/deliveryAttempts.js';
import { manifestScope, resourceGuard, uuidParam } from '../middleware/resourceAccess.js';
import { linkVehicleInclude, manifestVehicleAssignmentsInclude } from '../services/vehicleUnitService.js';
import { compositionIssues, describeUnitIssues, resolveManifestComposition, tractionRntrc } from '../services/vehicleUnitRules.js';
import {
    addOrderToManifest,
    assertOperationalTripType,
    completeManifest,
    completeManifestStop,
    OPERATIONAL_TRIP_TYPES,
    removeOrderFromManifest,
    startManifest,
    validateCreateManifestInput,
} from '../services/manifestLifecycle.js';

function mapManifestLegsToDemands(manifest: any) {
    if (!manifest) return null;
    const demands = (manifest.legs || []).map((leg: any) => {
        if (!leg.order || !leg.order.demand) return null;
        return {
            ...leg.order.demand,
            client: leg.order.demand.client,
            order: {
                id: leg.order.id,
                status: leg.order.status,
                nfNumber: leg.order.nfNumber,
                origemPrestacao: leg.order.origemPrestacao,
                fimPrestacao: leg.order.fimPrestacao,
                remetentePerson: leg.order.remetentePerson,
                destinatarioPerson: leg.order.destinatarioPerson,
                invoices: leg.order.invoicesRel ?? [],
            }
        };
    }).filter(Boolean);

    const demandsCount = demands.length;
    const { legs, _count, ...rest } = manifest;
    return {
        ...rest,
        demands,
        _count: _count ? { ..._count, demands: demandsCount } : undefined
    };
}

const router = Router();

// Anti-IDOR: HUB só viagens do próprio depósito (origem/destino/parada); LINK só as suas; CLIENT nunca.
router.use(uuidParam(), ...resourceGuard('manifest'));

const operationalTripTypeSchema = z.enum(OPERATIONAL_TRIP_TYPES);

/**
 * Quem está agindo sobre a execução da viagem: o próprio transportador (LINK atribuído) ou,
 * em nome dele, a torre (ADMIN) ou o hub de ORIGEM — nunca o hub de destino (NORTE #24).
 */
async function resolveTripActor(
    req: AuthRequest,
    manifest: { linkId: string | null; hubId: string | null },
): Promise<{ asLink: boolean; onBehalf: boolean }> {
    const roles = req.user!.roles;
    if (roles.includes('LINK')) {
        const link = await prisma.link.findFirst({ where: { userId: req.user!.id }, select: { id: true } });
        if (link && manifest.linkId === link.id) return { asLink: true, onBehalf: false };
    }
    const isOriginHub = roles.includes('HUB') && Boolean(req.user!.hubId) && manifest.hubId === req.user!.hubId;
    return { asLink: false, onBehalf: roles.includes('ADMIN') || isOriginHub };
}

// Validation schemas
const manifestSchema = z
    .object({
        vehicleTypeId: z.string().uuid('Invalid vehicle type ID'),
        origin: z.string().min(1, 'Origin is required'),
        originCity: z.string().min(1).optional(),
        originState: z.string().length(2).optional(),
        originCityIbgeCode: z.string().min(1).optional(),
        destination: z.string().min(1, 'Destination is required'),
        destinationCity: z.string().min(1).optional(),
        destinationState: z.string().length(2).optional(),
        destinationCityIbgeCode: z.string().min(1).optional(),
        startsWithCollection: z.boolean().default(false),
        tripType: operationalTripTypeSchema.default('TRANSFER'),
        hubId: z.string().uuid().optional(),
        destHubId: z.string().uuid().optional(),
        stops: z
            .array(
                z.object({
                    city: z.string(),
                    order: z.number(),
                })
            )
            .optional(),
    })
    .superRefine((data, ctx) => {
        if ((data.tripType === 'TRANSFER' || data.tripType === 'TRANSFER_DELIVERY') && !data.destHubId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Selecione o Hub ou filial da transferência',
                path: ['destHubId'],
            });
        }
    });

const ciotEnderecoSchema = z.object({
    bairro: z.string().min(1),
    cep: z.string().min(8),
    codigoMunicipio: z.number().int(),
    rua: z.string().min(1),
    numero: z.string().min(1),
    complemento: z.string().optional(),
});

const ciotPagamentoSchema = z
    .object({
        idPagamentoCliente: z.string().min(1),
        dataLiberacao: z.string().min(1),
        valor: z.number().nonnegative(),
        tipoPagamento: z.enum(['TransferenciaBancaria', 'eFRETE', 'DepositoAgendado']),
        categoria: z.enum(['Adiantamento', 'Estadia', 'Quitacao', 'SemCategoria']),
        cpfCnpjCreditado: z.string().min(11),
        indicadorPagamento: z.enum(['Avista', 'Aprazo']),
        numeroParcela: z.number().int().optional(),
        pix: z
            .object({
                tipoChave: z.enum(['CpfOuCnpj', 'Email', 'TelefoneCelular', 'ChaveAleatoria', 'IdentificadorPix']),
                valorChave: z.string().min(1),
                identificadorPix: z.string().optional(),
            })
            .optional(),
        informacoesBancarias: z
            .object({ instituicaoBancaria: z.string(), agencia: z.string(), conta: z.string(), tipoConta: z.string() })
            .optional(),
    })
    .refine((p) => Boolean(p.pix) !== Boolean(p.informacoesBancarias), {
        message: 'Pagamento exige ou pix ou informacoesBancarias, nunca os dois nem nenhum.',
    });

// Espelha CiotRequestData (efreteCiotMapper.ts) — validação na borda antes de persistir em CiotEmissionJob.requestData.
const ciotRequestDataSchema = z.object({
    documentoViagem: z.string().min(1),
    distanciaPercorrida: z.number().positive('Distância percorrida (km) é obrigatória.'),
    dataInicioViagem: z.string().optional(),
    dataFimViagem: z.string().min(1),
    codigoNcmNaturezaCarga: z.string().optional(),
    pesoCarga: z.number().nonnegative().optional(),
    codigoTipoCarga: z.number().int().min(1).max(12).optional(),
    tipoEmbalagem: z.string().optional(),
    altoDesempenho: z.boolean(),
    retornoVazio: z.boolean().optional(),
    composicaoVeicular: z.boolean(),
    tipoPagamento: z.enum(['TransferenciaBancaria', 'eFRETE', 'DepositoAgendado']),
    entregaDocumentacao: z.enum(['RedeCredenciada', 'Cliente']),
    valores: z.object({
        totalOperacao: z.number().nonnegative(),
        totalViagem: z.number().nonnegative(),
        totalAdiantamento: z.number().nonnegative(),
        totalQuitacao: z.number().nonnegative(),
        combustivel: z.number().nonnegative().optional(),
        pedagio: z.number().nonnegative().optional(),
        seguro: z.number().nonnegative().optional(),
    }),
    impostos: z.object({
        irrf: z.number().nonnegative().optional(),
        sestSenat: z.number().nonnegative().optional(),
        inss: z.number().nonnegative().optional(),
        issqn: z.number().nonnegative().optional(),
        outrosImpostos: z.number().nonnegative().optional(),
        descricaoOutrosImpostos: z.string().optional(),
    }),
    pagamentos: z.array(ciotPagamentoSchema).min(1, 'Ao menos 1 pagamento é obrigatório.'),
    destinatario: z.object({
        nomeOuRazaoSocial: z.string().min(1),
        cpfOuCnpj: z.string().min(11),
        endereco: ciotEnderecoSchema,
        responsavelPeloPagamento: z.boolean().optional(),
    }),
});

const emitCiotSchema = z.object({
    tipoViagemOverride: z.enum(['PADRAO', 'FRACIONADO', 'TAC_AGREGADO']).optional(),
    contratantesCargaFracionada: z.array(z.string().min(11)).optional(),
    requestData: ciotRequestDataSchema,
});

// GET /api/manifests - List manifests
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { status, linkId, hubId, includeArchived } = req.query;

        manifestScope(req.user!); // CLIENT (sem HUB/LINK/ADMIN) → 403
        const andConditions: Prisma.ManifestWhereInput[] = [];

        if (req.user!.roles.includes('LINK')) {
            const link = await prisma.link.findFirst({ where: { userId: req.user!.id } });
            if (!link) throw new AppError('Link profile not found', 404);
            andConditions.push({ linkId: link.id });
        } else if (linkId) {
            andConditions.push({ linkId: linkId as string });
        }

        // HUB sees manifests where it é origem, destino singular (legado) ou destino de alguma parada
        if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && req.user!.hubId) {
            andConditions.push({
                OR: [
                    { hubId: req.user!.hubId },
                    { destHubId: req.user!.hubId },
                    { tripStops: { some: { destHubId: req.user!.hubId } } },
                ],
            });
        } else if (hubId) {
            andConditions.push({ hubId: hubId as string });
        }

        if (status) andConditions.push({ status: status as any });
        if (includeArchived !== 'true' && status !== 'CANCELLED') andConditions.push({ archivedAt: null });

        const manifests = await prisma.manifest.findMany({
            where: andConditions.length > 0 ? { AND: andConditions } : {},
            include: {
                vehicleType: true,
                link: {
                    select: {
                        id: true, name: true, phone: true, document: true, vehiclePlate: true,
                        rntrc: true, carrierType: true, vehicleAxles: true, vehicleChassi: true, vehicleRenavam: true,
                        trailerPlate: true, trailer2Plate: true, trailer3Plate: true, ...linkVehicleInclude,
                    },
                },
                driver: { select: { id: true, name: true, document: true, cnhNumber: true, birthDate: true } },
                hub: {
                    select: { name: true, code: true }
                },
                destHub: {
                    select: { name: true, code: true }
                },
                fiscalDocuments: { orderBy: { createdAt: 'desc' } },
                vehicleAssignments: manifestVehicleAssignmentsInclude,
                cancelledLegs: { orderBy: { createdAt: 'asc' }, include: { order: { select: { id: true, status: true, nfNumber: true } } } },
                corrections: { orderBy: { createdAt: 'desc' } },
                freightAgreement: true,
                tripStops: {
                    orderBy: { sequence: 'asc' },
                    include: { destHub: { select: { id: true, name: true, code: true } } },
                },
                legs: {
                    include: {
                        order: {
                            include: {
                                remetentePerson: {
                                    select: { id: true, legalName: true, tradeName: true, document: true, city: true, state: true },
                                },
                                destinatarioPerson: {
                                    select: { id: true, legalName: true, tradeName: true, document: true, city: true, state: true },
                                },
                                invoicesRel: {
                                    orderBy: { createdAt: 'asc' },
                                    select: {
                                        id: true,
                                        type: true,
                                        nfNumber: true,
                                        nfKey: true,
                                        volumes: true,
                                        weight: true,
                                        cubedVolume: true,
                                        value: true,
                                    },
                                },
                                demand: {
                                    select: { id: true, origin: true, destination: true, commodity: true, weight: true, volume: true, nfValue: true, status: true }
                                }
                            }
                        }
                    }
                },
                _count: {
                    select: { legs: true }
                }
            },
            orderBy: { createdAt: 'desc' },
        });

        const mappedManifests = manifests.map(mapManifestLegsToDemands);
        const dataWithMargins = await Promise.all(
            mappedManifests.map(async (m: any) => {
                const marginInfo = await getManifestMargin(m.id);
                return {
                    ...m,
                    ...marginInfo,
                };
            })
        );

        res.json({
            success: true,
            data: dataWithMargins,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/manifests/:id
router.get('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const manifest = await prisma.manifest.findUnique({
            where: { id: id },
            include: {
                vehicleType: true,
                link: { include: { vehicleType: true, person: true, ...linkVehicleInclude } },
                driver: { include: { person: true } },
                driverAssignments: { orderBy: { sequence: 'asc' }, include: { driver: { include: { person: true } } } },
                hub: true,
                destHub: true,
                fiscalEmitter: true,
                fiscalDocuments: { orderBy: { createdAt: 'desc' } },
                vehicleAssignments: manifestVehicleAssignmentsInclude,
                cancelledLegs: { orderBy: { createdAt: 'asc' }, include: { order: { select: { id: true, status: true, nfNumber: true } } } },
                freightAgreement: true,
                corrections: { orderBy: { createdAt: 'desc' } },
                tripStops: {
                    orderBy: { sequence: 'asc' },
                    include: { destHub: { select: { id: true, name: true, code: true } } },
                },
                legs: {
                    include: {
                        order: {
                            include: {
                                remetentePerson: {
                                    select: { id: true, legalName: true, tradeName: true, document: true, city: true, state: true },
                                },
                                destinatarioPerson: {
                                    select: { id: true, legalName: true, tradeName: true, document: true, city: true, state: true },
                                },
                                invoicesRel: {
                                    orderBy: { createdAt: 'asc' },
                                    select: {
                                        id: true,
                                        type: true,
                                        nfNumber: true,
                                        nfKey: true,
                                        volumes: true,
                                        weight: true,
                                        cubedVolume: true,
                                        value: true,
                                    },
                                },
                                freightCalculations: {
                                    select: { status: true, documentType: true, cteNumber: true, minutaNumber: true },
                                },
                                demand: {
                                    include: {
                                        client: {
                                            select: { companyName: true }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
            }
        });

        if (!manifest) {
            throw new AppError('Manifest not found', 404);
        }

        // Estado do documento do frete por pedido (aditivo): a viagem mostra quem ainda não viaja documentado.
        for (const leg of manifest.legs) {
            const calcs = leg.order?.freightCalculations ?? [];
            (leg.order as unknown as { freightDocState?: FreightDocState }).freightDocState = freightDocState(calcs);
        }

        // Check access for links when the active account is not also an operational manager.
        if (req.user!.roles.includes('LINK') && !req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
            const link = await prisma.link.findFirst({
                where: { userId: req.user!.id }
            });
            if (!link || link.id !== manifest.linkId) {
                throw new AppError('Not authorized', 403);
            }
        }

        const marginInfo = await getManifestMargin(id);

        res.json({
            success: true,
            data: {
                ...mapManifestLegsToDemands(manifest),
                // Pernas enxutas para o O.S. (Carga da viagem): o mapper acima descarta `legs`.
                legs: manifest.legs.map((leg) => ({
                    id: leg.id,
                    orderId: leg.orderId,
                    legType: leg.legType,
                    destHubId: leg.destHubId,
                    stopId: leg.stopId,
                    completedAt: leg.completedAt,
                    order: leg.order
                        ? {
                              id: leg.order.id,
                              status: leg.order.status,
                              nfNumber: leg.order.nfNumber,
                              freightDocState: (leg.order as unknown as { freightDocState?: FreightDocState }).freightDocState ?? 'none',
                              freightCalculations: leg.order.freightCalculations,
                              demand: leg.order.demand
                                  ? { id: leg.order.demand.id, orderNumber: leg.order.demand.orderNumber, destination: leg.order.demand.destination }
                                  : null,
                          }
                        : null,
                })),
                ...marginInfo,
            },
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/manifests - Create manifest (Admin or HUB for own hub)
router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const data = manifestSchema.parse(req.body);

        // HUB can only create manifests for their own hub
        const isHubOnly = req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN');
        const effectiveHubId = isHubOnly
            ? req.user!.hubId
            : data.hubId;
        if (isHubOnly && (!effectiveHubId || effectiveHubId !== req.user!.hubId)) {
            throw new AppError('Hub user can only create manifests for their own hub', 403);
        }

        const manifest = await createManifestDraft(data, effectiveHubId ?? undefined);

        res.status(201).json({
            success: true,
            data: manifest,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

const manifestSetupSchema = z.object({
    vehicleTypeId: z.string().uuid().optional(),
    origin: z.string().min(1).optional(),
    originCity: z.string().min(1).nullable().optional(),
    originState: z.string().length(2).nullable().optional(),
    originCityIbgeCode: z.string().min(1).nullable().optional(),
    destination: z.string().min(1).optional(),
    destinationCity: z.string().min(1).nullable().optional(),
    destinationState: z.string().length(2).nullable().optional(),
    destinationCityIbgeCode: z.string().min(1).nullable().optional(),
    startsWithCollection: z.boolean().optional(),
    tripType: operationalTripTypeSchema.optional(),
    hubId: z.string().uuid().nullable().optional(),
    destHubId: z.string().uuid().nullable().optional(),
});

// PATCH /api/manifests/:id/setup — edita a rota principal sem recriar o rascunho.
router.patch('/:id/setup', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const data = manifestSetupSchema.parse(req.body);
        const current = await prisma.manifest.findUnique({ where: { id } });
        if (!current) throw new AppError('Manifest not found', 404);
        if (current.status !== 'DRAFT') {
            throw new AppError('Retire a oferta antes de editar a rota da viagem.', 409);
        }

        const isHubOnly = req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN');
        if (isHubOnly && current.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to modify this manifest', 403);
        }

        const tripType = data.tripType ?? assertOperationalTripType(current.tripType);
        const hubId = isHubOnly ? req.user!.hubId : (data.hubId !== undefined ? data.hubId : current.hubId);
        const destHubId = tripType === 'TRANSFER' || tripType === 'TRANSFER_DELIVERY'
            ? (data.destHubId !== undefined ? data.destHubId : current.destHubId)
            : null;

        await validateCreateManifestInput({
            vehicleTypeId: data.vehicleTypeId ?? current.vehicleTypeId,
            origin: data.origin ?? current.origin,
            destination: data.destination ?? current.destination,
            tripType,
            hubId: hubId ?? undefined,
            destHubId: destHubId ?? undefined,
        });

        const originTouched = ['origin', 'originCity', 'originState', 'originCityIbgeCode'].some(key => key in data);
        const destinationTouched = ['destination', 'destinationCity', 'destinationState', 'destinationCityIbgeCode'].some(key => key in data);
        const originSelection = originTouched ? await selectedManifestCity(data, 'origin', hubId) : {};
        const destinationSelection = destinationTouched ? await selectedManifestCity(data, 'destination', tripType === 'TRANSFER' ? destHubId : undefined) : {};
        const updated = await prisma.manifest.update({
            where: { id },
            data: {
                vehicleTypeId: data.vehicleTypeId,
                origin: data.origin,
                originCity: data.originCity,
                originState: data.originState,
                originCityIbgeCode: data.originCityIbgeCode,
                destination: data.destination,
                destinationCity: data.destinationCity,
                destinationState: data.destinationState,
                destinationCityIbgeCode: data.destinationCityIbgeCode,
                ...originSelection,
                ...destinationSelection,
                startsWithCollection: data.startsWithCollection,
                tripType: data.tripType,
                hubId,
                destHubId,
            },
            include: {
                vehicleType: true,
                hub: true,
                destHub: true,
            },
        });

        res.json({ success: true, data: updated, message: 'Rota da viagem atualizada.' });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// POST /api/manifests/:id/demands - Add order to manifest (Admin or HUB for own hub manifest)
router.post('/:id/demands', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const { demandId, orderId, stopId } = req.body;

        const targetOrderId = orderId ?? (demandId ? (await prisma.order.findUnique({ where: { demandId } }))?.id : null);
        if (!targetOrderId) {
            throw new AppError('Order ID or Demand ID with associated order is required', 400);
        }

        const manifestCheck = await prisma.manifest.findUnique({
            where: { id },
            select: { hubId: true },
        });
        if (!manifestCheck) {
            throw new AppError('Manifest not found', 404);
        }
        if (req.user!.roles.includes('HUB') && manifestCheck.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to modify this manifest', 403);
        }

        const admin = await prisma.admin.findUnique({ where: { userId: req.user!.id } });
        const actor = {
            userId: req.user!.id,
            role: req.user!.roles[0],
            adminId: admin?.id,
        };
        const { manifest, utilization } = await addOrderToManifest(id, targetOrderId, actor, stopId);

        res.json({
            success: true,
            data: mapManifestLegsToDemands(manifest),
            utilization,
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/manifests/:id/demands/:demandId - Remove order from manifest
router.delete('/:id/demands/:demandId', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const demandId = req.params.demandId as string;

        const targetOrderId = (await prisma.order.findUnique({ where: { demandId } }))?.id;
        if (!targetOrderId) {
            throw new AppError('Order not found for this demand', 404);
        }

        const manifestCheck = await prisma.manifest.findUnique({
            where: { id },
            select: { hubId: true },
        });
        if (!manifestCheck) {
            throw new AppError('Manifest not found', 404);
        }
        if (req.user!.roles.includes('HUB') && manifestCheck.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to modify this manifest', 403);
        }

        const admin = await prisma.admin.findUnique({ where: { userId: req.user!.id } });
        const actor = {
            userId: req.user!.id,
            role: req.user!.roles[0],
            adminId: admin?.id,
        };
        await removeOrderFromManifest(id, targetOrderId, actor);

        res.json({
            success: true,
            message: 'Demand removed from manifest',
        });
    } catch (error) {
        next(error);
    }
});

const manifestStopSchema = z
    .object({
        destHubId: z.string().uuid().optional(),
        destinationLabel: z.string().min(1).optional(),
        destCity: z.string().min(1).optional(),
        destState: z.string().length(2).optional(),
        destCityIbgeCode: z.string().min(1).optional(),
        purpose: z.enum(['PASSAGE', 'OPERATIONAL', 'TRANSFER', 'COLLECTION', 'DELIVERY']).default('PASSAGE'),
        plannedArrivalAt: z.string().datetime().optional(),
    })
    .superRefine((data, ctx) => {
        if (!data.destHubId && !data.destinationLabel && !data.destCity) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Informe um Hub/filial ou a cidade do ponto de percurso',
                path: ['destHubId'],
            });
        }
    });

// POST /api/manifests/:id/stops — cria uma parada/descarga da viagem (Admin/Hub, manifesto DRAFT)
router.post('/:id/stops', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const data = manifestStopSchema.parse(req.body);

        const manifest = await prisma.manifest.findUnique({
            where: { id },
            select: { hubId: true, status: true, tripType: true },
        });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to modify this manifest', 403);
        }
        if (manifest.status !== 'DRAFT') {
            throw new AppError('Só é possível adicionar paradas a um manifesto em rascunho', 400);
        }
        if (data.destHubId) {
            const destHub = await prisma.hub.findUnique({ where: { id: data.destHubId } });
            if (!destHub || !destHub.active) throw new AppError('Hub destino não encontrado ou inativo', 400);
        }

        const stopSelection = await selectedManifestCity(data, 'dest', data.destHubId);
        const lastStop = await prisma.manifestStop.findFirst({
            where: { manifestId: id },
            orderBy: { sequence: 'desc' },
        });
        const sequence = lastStop ? lastStop.sequence + 1 : 1;

        const stop = await prisma.manifestStop.create({
            data: {
                manifestId: id,
                sequence,
                destHubId: data.destHubId,
                destinationLabel: data.destinationLabel,
                destCity: data.destCity,
                destState: data.destState,
                destCityIbgeCode: data.destCityIbgeCode,
                ...stopSelection,
                purpose: data.purpose,
                plannedArrivalAt: data.plannedArrivalAt ? new Date(data.plannedArrivalAt) : undefined,
            },
        });

        res.status(201).json({ success: true, data: stop });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

const manifestStopUpdateSchema = z.object({
    destHubId: z.string().uuid().nullable().optional(),
    destinationLabel: z.string().min(1).nullable().optional(),
    destCity: z.string().min(1).nullable().optional(),
    destState: z.string().length(2).nullable().optional(),
    destCityIbgeCode: z.string().min(1).nullable().optional(),
    purpose: z.enum(['PASSAGE', 'OPERATIONAL', 'TRANSFER', 'COLLECTION', 'DELIVERY']).optional(),
    plannedArrivalAt: z.string().datetime().nullable().optional(),
});

// PATCH /api/manifests/:id/stops/:stopId — edita ponto manual em rascunho.
router.patch('/:id/stops/:stopId', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const stopId = req.params.stopId as string;
        const data = manifestStopUpdateSchema.parse(req.body);
        const manifest = await prisma.manifest.findUnique({ where: { id }, select: { hubId: true, status: true } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to modify this manifest', 403);
        }
        if (manifest.status !== 'DRAFT') throw new AppError('Retire a oferta antes de editar o percurso.', 409);

        const stop = await prisma.manifestStop.findUnique({ where: { id: stopId } });
        if (!stop || stop.manifestId !== id) throw new AppError('Ponto de percurso não encontrado.', 404);

        const destHubId = data.destHubId !== undefined ? data.destHubId : stop.destHubId;
        const destCity = data.destCity !== undefined ? data.destCity : stop.destCity;
        if (!destHubId && !destCity) throw new AppError('Informe um Hub/filial ou a cidade do ponto de percurso.', 400);
        if (destHubId) {
            const hub = await prisma.hub.findUnique({ where: { id: destHubId } });
            if (!hub?.active) throw new AppError('Hub destino não encontrado ou inativo.', 400);
        }

        const locationTouched = ['destCity', 'destState', 'destCityIbgeCode', 'destHubId'].some(key => key in data);
        const stopSelection = locationTouched ? await selectedManifestCity(data, 'dest', destHubId) : {};
        const updated = await prisma.manifestStop.update({
            where: { id: stopId },
            data: {
                destHubId: data.destHubId,
                destinationLabel: data.destinationLabel,
                destCity: data.destCity,
                destState: data.destState,
                destCityIbgeCode: data.destCityIbgeCode,
                ...stopSelection,
                purpose: data.purpose,
                plannedArrivalAt: data.plannedArrivalAt === null
                    ? null
                    : data.plannedArrivalAt
                        ? new Date(data.plannedArrivalAt)
                        : undefined,
            },
        });
        res.json({ success: true, data: updated, message: 'Ponto de percurso atualizado.' });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

// DELETE /api/manifests/:id/stops/:stopId — remove somente ponto sem pedidos vinculados.
router.delete('/:id/stops/:stopId', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const stopId = req.params.stopId as string;
        const manifest = await prisma.manifest.findUnique({ where: { id }, select: { hubId: true, status: true } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to modify this manifest', 403);
        }
        if (manifest.status !== 'DRAFT') throw new AppError('Retire a oferta antes de editar o percurso.', 409);

        const stop = await prisma.manifestStop.findUnique({ where: { id: stopId }, include: { _count: { select: { legs: true } } } });
        if (!stop || stop.manifestId !== id) throw new AppError('Ponto de percurso não encontrado.', 404);
        if (stop._count.legs > 0) throw new AppError('Este ponto possui pedidos vinculados e não pode ser removido.', 409);

        await prisma.$transaction(async (tx) => {
            await tx.manifestStop.delete({ where: { id: stopId } });
            const remaining = await tx.manifestStop.findMany({ where: { manifestId: id }, orderBy: { sequence: 'asc' } });
            for (const [index, item] of remaining.entries()) {
                if (item.sequence !== index + 1) {
                    await tx.manifestStop.update({ where: { id: item.id }, data: { sequence: index + 10001 } });
                }
            }
            for (const [index, item] of remaining.entries()) {
                await tx.manifestStop.update({ where: { id: item.id }, data: { sequence: index + 1 } });
            }
        });
        res.json({ success: true, message: 'Ponto de percurso removido.' });
    } catch (error) {
        next(error);
    }
});

const reorderStopsSchema = z.object({ stopIds: z.array(z.string().uuid()).min(1) });

router.patch('/:id/stops/reorder/all', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const { stopIds } = reorderStopsSchema.parse(req.body);
        const manifest = await prisma.manifest.findUnique({ where: { id }, select: { hubId: true, status: true } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to modify this manifest', 403);
        }
        if (manifest.status !== 'DRAFT') throw new AppError('Retire a oferta antes de reordenar o percurso.', 409);
        const existing = await prisma.manifestStop.findMany({ where: { manifestId: id }, select: { id: true } });
        const existingIds = new Set(existing.map((item) => item.id));
        if (stopIds.length !== existing.length || stopIds.some((stopId) => !existingIds.has(stopId))) {
            throw new AppError('A ordem precisa conter todos os pontos desta viagem.', 400);
        }
        await prisma.$transaction(async (tx) => {
            for (const [index, stopId] of stopIds.entries()) {
                await tx.manifestStop.update({ where: { id: stopId }, data: { sequence: index + 10001 } });
            }
            for (const [index, stopId] of stopIds.entries()) {
                await tx.manifestStop.update({ where: { id: stopId }, data: { sequence: index + 1 } });
            }
        });
        res.json({ success: true, message: 'Percurso reordenado.' });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

router.get('/:id/delivery-progress', authenticate, authorize('ADMIN', 'HUB', 'LINK'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try { res.json({ success: true, data: await listManifestDeliveryProgress(req.params.id as string) }); }
    catch (error) { next(error); }
});

router.post('/:id/delivery-attempts', authenticate, authorize('ADMIN', 'HUB', 'LINK'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const input = z.object({
            orderId: z.string().uuid(),
            result: z.enum(['DELIVERED', 'PARTIAL', 'FAILED']),
            deliveredQuantity: z.number().int().min(0).optional(),
            receiverName: z.string().trim().max(160).optional(),
            occurredAt: z.string().datetime().optional(),
            evidenceStorageKey: z.string().trim().max(500).optional(),
            exceptionReason: z.string().trim().max(1000).optional(),
            nextAction: z.enum(['REATTEMPT', 'RETURN_TO_HUB', 'TRANSFER']).optional(),
            performedByUserId: z.string().uuid().optional(),
            idempotencyKey: z.string().uuid(),
        }).parse(req.body);
        const performedByUserId = req.user!.roles.includes('LINK') && !req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB') ? req.user!.id : input.performedByUserId;
        const attempt = await recordDeliveryAttempt(req.params.id as string, req.user!.id, { ...input, performedByUserId });
        res.status(201).json({ success: true, data: attempt });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

// PATCH /api/manifests/:id/stops/:stopId/complete — conclui só os pedidos daquela parada
// HUB pode concluir a parada em que é o destino (confirma recebimento da carga que chegou);
// LINK/ADMIN mantêm acesso total (motorista confirmando entrega, ou operação central).
router.patch('/:id/stops/:stopId/complete', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('LINK') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const stopId = req.params.stopId as string;
        const kmChegada = typeof req.body?.kmChegada === 'number' ? req.body.kmChegada : undefined;

        if (req.user!.roles.includes('LINK') && !req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
            const link = await prisma.link.findFirst({ where: { userId: req.user!.id }, select: { id: true } });
            const assigned = link && await prisma.manifest.findFirst({ where: { id, linkId: link.id }, select: { id: true } });
            if (!assigned) throw new AppError('Manifest not found', 404);
        }

        if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('LINK')) {
            const stop = await prisma.manifestStop.findUnique({ where: { id: stopId }, select: { manifestId: true, destHubId: true } });
            if (!stop || stop.manifestId !== id) {
                throw new AppError('Parada não encontrada para este manifesto', 404);
            }
            if (!req.user!.hubId || stop.destHubId !== req.user!.hubId) {
                throw new AppError('Not authorized — esta parada não é destino do seu hub.', 403);
            }
        }

        const admin = await prisma.admin.findUnique({ where: { userId: req.user!.id } });
        const actor = {
            userId: req.user!.id,
            role: req.user!.roles[0],
            adminId: admin?.id,
        };
        const result = await completeManifestStop(id, stopId, actor, { kmChegada });
        res.json({
            success: true,
            data: result,
            message: result.allStopsCompleted ? 'Parada concluída — viagem finalizada.' : 'Parada concluída.',
        });
    } catch (error) {
        next(error);
    }
});

const manifestCapaSchema = z.object({
    fiscalEmitterId: z.string().uuid().optional(),
    plannedDepartureAt: z.string().datetime().optional(),
    plannedArrivalAt: z.string().datetime().optional(),
    notes: z.string().optional(),
    seloLacre: z.string().optional(),
    liberacao: z.string().optional(),
});

// PATCH /api/manifests/:id/capa — dados de capa da viagem (emitente, datas previstas, lacre etc.)
router.patch('/:id/capa', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const data = manifestCapaSchema.parse(req.body);

        const manifest = await prisma.manifest.findUnique({ where: { id }, select: { hubId: true, status: true } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to modify this manifest', 403);
        }
        if (manifest.status === 'COMPLETED' || manifest.status === 'CANCELLED') {
            throw new AppError('Não é possível editar a capa de uma viagem concluída/cancelada', 400);
        }

        const updated = await prisma.manifest.update({
            where: { id },
            data: {
                fiscalEmitterId: data.fiscalEmitterId,
                plannedDepartureAt: data.plannedDepartureAt ? new Date(data.plannedDepartureAt) : undefined,
                plannedArrivalAt: data.plannedArrivalAt ? new Date(data.plannedArrivalAt) : undefined,
                notes: data.notes,
                seloLacre: data.seloLacre,
                liberacao: data.liberacao,
            },
        });

        res.json({ success: true, data: updated });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

const freightAgreementSchema = z.object({
    freteBruto: z.number().nonnegative(),
    adiantamento: z.number().nonnegative().optional(),
    pedagio: z.number().nonnegative().optional(),
    irrf: z.number().nonnegative().optional(),
    inss: z.number().nonnegative().optional(),
    issqn: z.number().nonnegative().optional(),
    sestSenat: z.number().nonnegative().optional(),
    outrosDescontos: z.number().nonnegative().optional(),
    outrosDescontosDescricao: z.string().optional(),
});

// GET /api/manifests/:id/trip-price-estimate — prévia de custo sem alterar a Carta Frete
router.get('/:id/trip-price-estimate', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const manifest = await prisma.manifest.findUnique({ where: { id }, select: { hubId: true } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to access this manifest', 403);
        }
        res.json({ success: true, data: await getManifestTripPriceEstimate(id) });
    } catch (error) {
        next(error);
    }
});

// GET /api/manifests/:id/freight-agreement — Carta Frete estruturada da viagem
router.get('/:id/freight-agreement', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const agreement = await prisma.manifestFreightAgreement.findUnique({ where: { manifestId: id } });
        res.json({ success: true, data: agreement });
    } catch (error) {
        next(error);
    }
});

// PUT /api/manifests/:id/freight-agreement — cria/atualiza a Carta Frete estruturada da viagem
router.put('/:id/freight-agreement', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const data = freightAgreementSchema.parse(req.body);

        const manifest = await prisma.manifest.findUnique({ where: { id }, select: { hubId: true, status: true } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to modify this manifest', 403);
        }
        if (manifest.status === 'COMPLETED' || manifest.status === 'CANCELLED') {
            throw new AppError('Não é possível editar a Carta Frete de uma viagem concluída/cancelada', 400);
        }

        const agreement = await upsertFreightAgreement(id, data);

        res.json({ success: true, data: agreement });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

const manifestAssignmentSchema = z.object({
    linkId: z.string().uuid().nullable(),
    driverId: z.string().uuid().nullable().optional(),
});

// associateLinkId: o motorista é independente do transportador; ao escolhê-lo para a viagem, o vínculo
// (DriverCarrier) é criado/reativado na mesma transação em vez de recusar o motorista.
async function replaceManifestDrivers(manifestId: string, driverIds: string[], expectedUpdatedAt: Date, linkId?: string | null, associateLinkId?: string | null) {
    return prisma.$transaction(async (tx) => {
        const updated = await tx.manifest.updateMany({
            where: { id: manifestId, status: 'DRAFT', updatedAt: expectedUpdatedAt },
            data: { driverId: driverIds[0] ?? null, ...(linkId !== undefined ? { linkId } : {}), updatedAt: new Date() },
        });
        if (updated.count !== 1) throw new AppError('A viagem mudou durante a edição. Recarregue e tente novamente.', 409);
        await tx.manifestDriverAssignment.deleteMany({ where: { manifestId } });
        if (associateLinkId) {
            for (const driverId of driverIds) {
                await tx.driverCarrier.upsert({
                    where: { driverId_linkId: { driverId, linkId: associateLinkId } },
                    create: { driverId, linkId: associateLinkId },
                    update: { active: true },
                });
            }
        }
        if (driverIds.length) {
            await tx.manifestDriverAssignment.createMany({ data: driverIds.map((driverId, index) => ({
                manifestId, driverId, sequence: index + 1, isPrimary: index === 0,
            })) });
        }
        return tx.manifest.findUniqueOrThrow({ where: { id: manifestId }, include: { link: true, driver: true, vehicleType: true, driverAssignments: { orderBy: { sequence: 'asc' }, include: { driver: true } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

// PATCH /api/manifests/:id/assignment — escolhe o responsável sem enviar a oferta.
router.patch('/:id/assignment', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const data = manifestAssignmentSchema.parse(req.body);
        const manifest = await prisma.manifest.findUnique({ where: { id } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to modify this manifest', 403);
        }
        if (manifest.status !== 'DRAFT') {
            throw new AppError('Retire a oferta antes de trocar o responsável.', 409);
        }

        if (!data.linkId) {
            const cleared = await replaceManifestDrivers(id, [], manifest.updatedAt, null);
            return res.json({ success: true, data: cleared, message: 'Responsável removido.' });
        }

        const link = await prisma.link.findUnique({ where: { id: data.linkId } });
        if (!link || link.approvalStatus === 'REJECTED') {
            throw new AppError('Transportador não encontrado ou recusado.', 404);
        }

        const linkDrivers = await prisma.driver.findMany({
            where: { active: true, OR: [{ linkId: link.id }, { carriers: { some: { linkId: link.id, active: true } } }] },
            orderBy: { createdAt: 'asc' },
        });
        // Motorista é global (por CPF): se o escolhido está ativo mas ainda sem vínculo com este transportador, vincula.
        let selectedExternal: { id: string } | null = null;

        let driverId: string | null = null;
        if (data.driverId) {
            const selectedDriver = linkDrivers.find((driver) => driver.id === data.driverId)
                ?? await prisma.driver.findFirst({ where: { id: data.driverId, active: true }, select: { id: true } });
            if (!selectedDriver) throw new AppError('Motorista não encontrado ou inativo.', 404);
            if (!linkDrivers.some((driver) => driver.id === selectedDriver.id)) selectedExternal = selectedDriver;
            driverId = selectedDriver.id;
        } else if (linkDrivers.length === 1) {
            driverId = linkDrivers[0].id;
        } else if (manifest.driverId && linkDrivers.some((driver) => driver.id === manifest.driverId)) {
            driverId = manifest.driverId;
        }

        const existingAssignments = await prisma.manifestDriverAssignment.findMany({ where: { manifestId: id }, orderBy: { sequence: 'asc' } });
        const retained = existingAssignments.map((assignment) => assignment.driverId).filter((id) => linkDrivers.some((driver) => driver.id === id));
        const updated = await replaceManifestDrivers(id, driverId ? [driverId, ...retained.filter((id) => id !== driverId)] : [], manifest.updatedAt, link.id, selectedExternal ? link.id : null);
        res.json({
            success: true,
            data: updated,
            message: driverId
                ? 'Responsável e dados fiscais vinculados.'
                : 'Responsável vinculado. Complete os dados fiscais do motorista.',
        });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

// GET /api/manifests/:id/readiness — mesma prontidão usada pela UI e pela oferta.
router.get('/:id/readiness', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const manifest = await prisma.manifest.findUnique({ where: { id }, select: { hubId: true, linkId: true } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized', 403);
        }
        if (req.user!.roles.includes('LINK') && !req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
            const link = await prisma.link.findFirst({ where: { userId: req.user!.id }, select: { id: true } });
            if (!link || manifest.linkId !== link.id) throw new AppError('Not authorized', 403);
        }
        const readiness = await getManifestReadiness(id);
        // Quem planeja (ADMIN/HUB) recebe também quais ações de edição/cancelamento cabem agora e por quê.
        const planningActions = req.user!.roles.includes('ADMIN') || req.user!.roles.includes('HUB') ? await getPlanningActions(id) : undefined;
        res.json({ success: true, data: { ...readiness, ...(planningActions ? { planningActions } : {}) } });
    } catch (error) {
        next(error);
    }
});

// POST /api/manifests/:id/offer — transição explícita após a revisão.
router.put('/:id/vehicles', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        await assertManifestPlanningAccess(req);
        const data = manifestVehiclesSchema.parse(req.body);
        const assigned = await setManifestVehicles(req.params.id as string, data);
        res.json({ success: true, data: assigned, message: 'Composição da viagem salva. As unidades podem ser reutilizadas em outras viagens.' });
    } catch (error) { next(error); }
});

// POST /api/manifests/:id/offer — transição explícita após a revisão.
router.post('/:id/offer', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const manifest = await prisma.manifest.findUnique({ where: { id } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to modify this manifest', 403);
        }
        if (manifest.status !== 'DRAFT') throw new AppError('A viagem não está em rascunho.', 409);

        const readiness = await getManifestReadiness(id);
        if (!readiness.canOffer) {
            return res.status(422).json({
                success: false,
                error: 'A viagem ainda possui pendências antes da oferta.',
                data: readiness,
            });
        }

        const updated = await publishManifestOffer(id);
        res.json({ success: true, data: updated, message: 'Oferta enviada ao responsável.' });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/withdraw-offer', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const manifest = await prisma.manifest.findUnique({ where: { id } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized to modify this manifest', 403);
        }
        if (manifest.status !== 'PENDING_ACCEPT') throw new AppError('A viagem não possui uma oferta pendente.', 409);
        const withdrawn = await prisma.manifest.updateMany({
            where: { id, status: 'PENDING_ACCEPT' },
            data: { status: 'DRAFT', offeredAt: null, compositionSnapshot: Prisma.DbNull },
        });
        if (withdrawn.count !== 1) throw new AppError('A oferta já foi aceita ou retirada. Atualize a página.', 409);
        const updated = await prisma.manifest.findUniqueOrThrow({ where: { id } });
        res.json({ success: true, data: updated, message: 'Oferta retirada. O planejamento foi reaberto.' });
    } catch (error) {
        next(error);
    }
});

const reasonSchema = z.object({ reason: z.string().trim().min(8, 'Explique o motivo em pelo menos 8 caracteres.').max(2000) });

async function assertManifestPlanningAccess(req: AuthRequest) {
    if (req.user!.roles.includes('ADMIN')) return;
    const manifest = await prisma.manifest.findUnique({ where: { id: req.params.id as string }, select: { hubId: true } });
    if (!manifest || manifest.hubId !== req.user!.hubId) throw new AppError('Esta viagem não pertence à sua unidade de origem.', 403);
}

router.post('/:id/reopen', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        await assertManifestPlanningAccess(req);
        const { reason } = reasonSchema.parse(req.body);
        const data = await reopenAcceptedManifest(req.params.id as string, req.user!.id, reason);
        res.json({ success: true, data, message: 'Planejamento reaberto. Envie uma nova oferta após corrigir a viagem.' });
    } catch (error) { next(error); }
});

router.post('/:id/cancel', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        await assertManifestPlanningAccess(req);
        const { reason } = reasonSchema.parse(req.body);
        const data = await cancelManifest(req.params.id as string, req.user!.id, reason);
        res.json({ success: true, data, message: 'Viagem cancelada e retirada da lista operacional.' });
    } catch (error) { next(error); }
});

router.delete('/:id', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        await assertManifestPlanningAccess(req);
        await deleteEmptyManifest(req.params.id as string);
        res.json({ success: true, message: 'Rascunho vazio excluído.' });
    } catch (error) { next(error); }
});

router.post('/:id/corrections', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        await assertManifestPlanningAccess(req);
        const input = reasonSchema.extend({ kind: z.enum(['ROUTE', 'STOP', 'VEHICLE', 'DRIVER']), after: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])) }).parse(req.body);
        const data = await requestManifestCorrection({ manifestId: req.params.id as string, actorUserId: req.user!.id, ...input });
        res.status(202).json({ success: true, data, message: 'Correção registrada para análise fiscal. Os documentos e a rota não foram alterados.' });
    } catch (error) { next(error); }
});

// POST /api/manifests/:id/corrections/:correctionId/resolve — conclui a correção após a resposta dos provedores.
router.post('/:id/corrections/:correctionId/resolve', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        await assertManifestPlanningAccess(req);
        const input = z.object({
            outcome: z.enum(['APPLIED', 'REJECTED', 'SUCCESSOR']),
            note: z.string().trim().min(8, 'Descreva a conclusão em pelo menos 8 caracteres.').max(2000),
        }).parse(req.body);
        const data = await resolveManifestCorrection({ manifestId: req.params.id as string, correctionId: req.params.correctionId as string, actorUserId: req.user!.id, ...input });
        const message = input.outcome === 'SUCCESSOR' ? 'Viagem sucessora aberta em rascunho, vinculada à original.'
            : input.outcome === 'APPLIED' ? 'Correção concluída com os documentos regularizados.' : 'Correção descartada.';
        res.json({ success: true, data, message });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

// PATCH /api/manifests/:id/assign - Assign manifest to link
router.patch('/:id/assign', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const { linkId } = req.body;

        if (!linkId) {
            throw new AppError('Link ID is required', 400);
        }

        if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN')) {
            const manifestCheck = await prisma.manifest.findUnique({ where: { id }, select: { hubId: true } });
            if (!manifestCheck) throw new AppError('Manifest not found', 404);
            if (manifestCheck.hubId !== req.user!.hubId) {
                throw new AppError('Not authorized to modify this manifest', 403);
            }
        }

        const link = await prisma.link.findUnique({
            where: { id: linkId as string }
        });

        if (!link || link.approvalStatus !== 'APPROVED') {
            throw new AppError('Link not found or not approved', 404);
        }

        const current = await prisma.manifest.findUnique({ where: { id } });
        if (!current || current.status !== 'DRAFT') throw new AppError('Somente uma viagem em rascunho pode ser ofertada.', 409);
        await prisma.manifest.update({ where: { id }, data: { linkId } });
        const readiness = await getManifestReadiness(id);
        if (!readiness.canOffer) throw new AppError('Resolva as pendências antes de ofertar a viagem.', 422);
        const manifest = await publishManifestOffer(id);

        // TODO: Send WhatsApp notification to link

        res.json({
            success: true,
            data: mapManifestLegsToDemands(manifest),
            message: 'Manifest offered to link',
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/manifests/:id/accept - Link accepts manifest
router.patch('/:id/accept', authenticate, authorize('LINK', 'HUB', 'ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const manifest = await prisma.manifest.findUnique({
            where: { id },
            select: { id: true, status: true, linkId: true, hubId: true, link: { select: { name: true } }, legs: { select: { orderId: true } } },
        });
        if (!manifest) throw new AppError('Manifest not found', 404);

        // NORTE #24: o hub de origem (ou a torre) confirma em nome do transportador.
        const { asLink, onBehalf } = await resolveTripActor(req, manifest);
        if (!asLink && !onBehalf) throw new AppError('Manifest not found or not assigned to you', 404);
        if (manifest.status !== 'PENDING_ACCEPT') throw new AppError('Manifest is not pending acceptance', 400);
        if (!manifest.linkId) throw new AppError('Defina o transportador antes de confirmar.', 422);

        const updated = await prisma.$transaction(async (tx) => {
            const changed = await tx.manifest.updateMany({
                where: { id, status: 'PENDING_ACCEPT' },
                data: { status: 'ACCEPTED', acceptedAt: new Date() },
            });
            if (changed.count !== 1) throw new AppError('A viagem mudou de situação. Atualize e tente de novo.', 409);
            if (onBehalf) {
                for (const leg of manifest.legs) {
                    await tx.orderHistory.create({
                        data: {
                            orderId: leg.orderId,
                            eventType: 'NOTE',
                            description: `Transportador ${manifest.link?.name ?? 'da viagem'} confirmado pelo hub, em nome do transportador`,
                            actorUserId: req.user!.id,
                        },
                    });
                }
            }
            return tx.manifest.findUnique({ where: { id } });
        });

        res.json({
            success: true,
            data: updated,
            message: 'Manifest accepted',
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/manifests/:id/reject - Link rejects manifest
router.patch('/:id/reject', authenticate, authorize('LINK'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const { reason } = req.body;

        const link = await prisma.link.findFirst({
            where: { userId: req.user!.id }
        });

        if (!link) {
            throw new AppError('Link profile not found', 404);
        }

        const manifest = await prisma.manifest.findUnique({
            where: { id: id }
        });

        if (!manifest || manifest.linkId !== link.id) {
            throw new AppError('Manifest not found or not assigned to you', 404);
        }

        const updated = await prisma.manifest.update({
            where: { id: id },
            data: {
                status: 'DRAFT',
                linkId: null,
                rejectedAt: new Date(),
                rejectionReason: reason,
                offeredAt: null,
            },
        });

        res.json({
            success: true,
            data: updated,
            message: 'Manifest rejected',
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/manifests/:id/start - Start manifest execution
router.patch('/:id/start', authenticate, authorize('LINK', 'HUB', 'ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const kmSaida = typeof req.body?.kmSaida === 'number' ? req.body.kmSaida : undefined;

        const manifest = await prisma.manifest.findUnique({ where: { id }, select: { linkId: true, hubId: true } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        const { asLink, onBehalf } = await resolveTripActor(req, manifest);
        if (!asLink && !onBehalf) throw new AppError('Manifest not found', 404);

        await startManifest(id, { kmSaida, actor: { userId: req.user!.id, onBehalfOfLink: onBehalf } });

        res.json({
            success: true,
            message: 'Manifest started',
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/manifests/:id/complete - Complete manifest. HUB pode concluir uma viagem TRANSFER
// da qual é o destino (confirma recebimento); DELIVERY continua exclusivo de LINK/ADMIN
// (confirmação de entrega ao cliente final não é ato do hub).
router.patch('/:id/complete', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('LINK') && !req.user!.roles.includes('HUB')) {
        return next(new AppError('Not authorized', 403));
    }
    try {
        const id = req.params.id as string;
        const kmChegada = typeof req.body?.kmChegada === 'number' ? req.body.kmChegada : undefined;

        if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('LINK')) {
            const manifest = await prisma.manifest.findUnique({ where: { id }, select: { tripType: true, destHubId: true } });
            if (!manifest) throw new AppError('Manifest not found', 404);
            if (manifest.tripType !== 'TRANSFER' || !req.user!.hubId || manifest.destHubId !== req.user!.hubId) {
                throw new AppError('Not authorized — esta viagem não é uma transferência com destino ao seu hub.', 403);
            }
        }

        const admin = await prisma.admin.findUnique({ where: { userId: req.user!.id } });
        const actor = {
            userId: req.user!.id,
            role: req.user!.roles[0],
            adminId: admin?.id,
        };
        await completeManifest(id, actor, { kmChegada });

        res.json({
            success: true,
            message: 'Manifest completed',
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/manifests/:id/emit-mdfe — MDF-e (ACBr) para viagem com CT-es autorizados
router.post('/:id/emit-mdfe', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        if (!isAcbrCredentialsConfigured()) {
            throw new AppError('MDF-e via ACBr requer ACBR_CLIENT_ID e ACBR_CLIENT_SECRET.', 503);
        }

        const manifest = await prisma.manifest.findUnique({ where: { id }, include: { hub: true } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && req.user!.hubId && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized', 403);
        }
        if (manifest.status !== 'ACCEPTED') throw new AppError('Aceite a oferta antes de emitir o MDF-e desta viagem.', 409);

        const blocking = () => prisma.manifestFiscalDocument.findFirst({
            where: { manifestId: id, documentType: 'MDFE', status: { in: ['AUTHORIZED', 'SENT', 'READY'] } },
        });
        let dup = await blocking();
        if (dup?.status === 'SENT') {
            // Emissão anterior sem desfecho (timeout/queda): concilia com o provedor em vez de reemitir.
            const reconciled = await reconcileMdfeDocument(dup.id);
            if (reconciled.ok) {
                const doc = await prisma.manifestFiscalDocument.findUnique({ where: { id: dup.id } });
                return res.json({ success: true, data: doc, mdfe: reconciled });
            }
            dup = await blocking();
            if (dup) {
                return res.status(202).json({
                    success: true,
                    pending: true,
                    data: dup,
                    message: reconciled.error ?? 'MDF-e em processamento. Não reemita — consulte novamente em instantes.',
                });
            }
        } else if (dup) {
            throw new AppError('MDF-e já existe ou está em processamento para este manifesto.', 409);
        }

        const result = await emitMdfeViaAcbr(id, id);
        if (result.pending) {
            const doc = result.docId ? await prisma.manifestFiscalDocument.findUnique({ where: { id: result.docId } }) : null;
            return res.status(202).json({ success: true, pending: true, data: doc, message: result.error });
        }
        if (!result.ok) {
            if (!result.docId) {
                // Falha antes de qualquer envio ao provedor (validação): nenhum número foi consumido.
                await prisma.manifestFiscalDocument.create({
                    data: {
                        manifestId: id,
                        documentType: 'MDFE',
                        status: 'REJECTED',
                        statusReason: result.error ?? 'Falha MDF-e',
                        rawResponse: (result.raw ?? { error: result.error }) as object,
                        rejectedAt: new Date(),
                    },
                });
            }
            throw new AppError(result.error ?? 'Falha ao emitir MDF-e', 400);
        }

        const doc = await prisma.manifestFiscalDocument.findUnique({ where: { id: result.docId! } });

        res.json({ success: true, data: doc, mdfe: result });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/manifests/:id/driver — "Definir Motorista", passo separado de assign (Link)
router.patch('/:id/driver', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const { driverId } = req.body as { driverId?: string };
        if (!driverId) throw new AppError('driverId is required', 400);

        const manifest = await prisma.manifest.findUnique({ where: { id } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && req.user!.hubId && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized', 403);
        }
        if (!manifest.linkId) throw new AppError('Defina o Link (transportador) antes de definir o motorista.', 400);
        if (manifest.status !== 'DRAFT') throw new AppError('Reabra o planejamento ou registre uma correção antes de trocar o motorista.', 409);

        const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true, active: true } });
        if (!driver || !driver.active) throw new AppError('Motorista não encontrado ou inativo.', 404);

        const current = await prisma.manifestDriverAssignment.findMany({ where: { manifestId: id }, orderBy: { sequence: 'asc' } });
        const updated = await replaceManifestDrivers(id, [driverId, ...current.map((assignment) => assignment.driverId).filter((id) => id !== driverId)], manifest.updatedAt, undefined, manifest.linkId);
        res.json({ success: true, data: updated, message: 'Motorista definido' });
    } catch (error) {
        next(error);
    }
});

// A ordem é operacional: o primeiro condutor é o principal usado no CIOT.
router.put('/:id/drivers', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const { driverIds } = z.object({ driverIds: z.array(z.string().uuid()).min(1).max(10) }).parse(req.body);
        if (new Set(driverIds).size !== driverIds.length) throw new AppError('Não repita o mesmo motorista na viagem.', 400);
        const manifest = await prisma.manifest.findUnique({ where: { id } });
        if (!manifest) throw new AppError('Viagem não encontrada.', 404);
        if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && manifest.hubId !== req.user!.hubId) throw new AppError('Sem acesso a esta viagem.', 403);
        if (manifest.status !== 'DRAFT') throw new AppError('Retire a oferta ou registre correção antes de alterar os motoristas.', 409);
        if (!manifest.linkId) throw new AppError('Selecione primeiro o transportador.', 400);
        const drivers = await prisma.driver.findMany({ where: { id: { in: driverIds }, active: true } });
        if (drivers.length !== driverIds.length) throw new AppError('Motorista não encontrado ou inativo.', 400);
        const updated = await replaceManifestDrivers(id, driverIds, manifest.updatedAt, undefined, manifest.linkId);
        res.json({ success: true, data: updated });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

// POST /api/manifests/:id/ciot-dispensa — decisão fiscal justificada e auditada.
router.post('/:id/ciot-dispensa', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { motivo } = z.object({ motivo: z.string().trim().min(10, 'Informe o motivo da dispensa de CIOT com pelo menos 10 caracteres.') }).parse(req.body);
        const updated = await dispenseManifestCiot(String(req.params.id), req.user!, motivo);
        res.json({ success: true, data: updated, message: 'Dispensa de CIOT registrada.' });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

// POST /api/manifests/:id/ciot-dispensa/desfazer — permitido até a autorização do MDF-e.
router.post('/:id/ciot-dispensa/desfazer', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const updated = await undoManifestCiotDispensa(String(req.params.id), req.user!);
        res.json({ success: true, data: updated, message: 'Dispensa de CIOT desfeita.' });
    } catch (error) {
        next(error);
    }
});

// GET /api/manifests/:id/ciot-suggestion — sugestão Padrao/Fracionado antes de emitir
router.get('/:id/ciot-suggestion', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const manifest = await prisma.manifest.findUnique({ where: { id } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && req.user!.hubId && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized', 403);
        }

        const suggestion = await suggestCiotTipoViagem(id);
        res.json({ success: true, data: { ...suggestion, override: manifest.ciotTipoViagemOverride } });
    } catch (error) {
        next(error);
    }
});

// GET /api/manifests/:id/ciot-status — polling da fila assíncrona
router.get('/:id/ciot-status', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const job = await prisma.ciotEmissionJob.findFirst({ where: { manifestId: id }, orderBy: { createdAt: 'desc' } });
        res.json({ success: true, data: job });
    } catch (error) {
        next(error);
    }
});

// GET /api/manifests/:manifestId/fiscal-documents/:documentId/pdf
router.get('/:id/fiscal-documents/:documentId/pdf', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const manifestId = String(req.params.id);
        const documentId = String(req.params.documentId);
        const manifest = await prisma.manifest.findUnique({ where: { id: manifestId }, select: { hubId: true } });
        if (!manifest) throw new AppError('Manifesto não encontrado.', 404);
        if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Sem acesso a este manifesto.', 403);
        }
        const document = await prisma.manifestFiscalDocument.findFirst({ where: { id: documentId, manifestId, documentType: 'CIOT', status: 'AUTHORIZED' } });
        if (!document?.pdfUrl?.startsWith('s3:')) throw new AppError('PDF do CIOT não arquivado.', 404);
        const key = document.pdfUrl.slice(3);
        if (!key) throw new AppError('Referência de PDF inválida.', 404);
        res.json({ downloadUrl: await getObjectDownloadUrl(key, 300), expiresInSeconds: 300 });
    } catch (err) { next(err); }
});

// POST /api/manifests/:id/emit-ciot — emissão real via eFrete (assíncrona, fila BullMQ)
router.post('/:id/emit-ciot', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        if (!isEfreteCredentialsConfigured()) {
            throw new AppError('CIOT via eFrete requer EFRETE_USUARIO, EFRETE_SENHA e EFRETE_INTEGRADOR.', 503);
        }
        const body = emitCiotSchema.parse(req.body);

        const manifest = await prisma.manifest.findUnique({ where: { id }, include: { link: { include: linkVehicleInclude }, driver: true, fiscalEmitter: { select: { efreteEnvironment: true } }, vehicleAssignments: manifestVehicleAssignmentsInclude } });
        if (!manifest) throw new AppError('Manifest not found', 404);
        if (req.user!.roles.includes('HUB') && req.user!.hubId && manifest.hubId !== req.user!.hubId) {
            throw new AppError('Not authorized', 403);
        }
        if (manifest.status !== 'ACCEPTED') throw new AppError('Aceite a oferta antes de emitir o CIOT desta viagem.', 409);

        // Preflight — falhar cedo com mensagem clara em vez de deixar o job travar depois na eFrete.
        if (!manifest.driverId || !manifest.driver) throw new AppError('Defina o motorista da viagem antes de emitir o CIOT ("Definir Motorista").', 400);
        if (!manifest.link) throw new AppError('Manifesto sem Link (transportador) atribuído.', 400);
        const composition = resolveManifestComposition(manifest);
        const contratadoRntrc = tractionRntrc(composition, manifest.link.rntrc);
        if (!contratadoRntrc || !manifest.link.carrierType) throw new AppError('Cadastre o RNTRC do cavalo e o tipo de transportador (TAC/ETC/CTC/FROTA) do Link antes de emitir o CIOT.', 400);
        const unitIssues = compositionIssues(composition);
        if (unitIssues.length) {
            throw new AppError(`Complete os dados do veículo antes de emitir o CIOT: ${unitIssues.map((i) => `${i.plate ?? 'cavalo'} (${describeUnitIssues(i)})`).join('; ')}.`, 400);
        }
        if (!manifest.driver.cnhNumber || !manifest.driver.birthDate) throw new AppError('Motorista sem CNH/data de nascimento cadastrados.', 400);

        const readiness = await getManifestReadiness(id);
        if (readiness.issues.some((issue) => issue.step !== 'fiscal' && issue.severity === 'blocking')) {
            throw new AppError('A viagem ainda possui pendências operacionais para emissão do CIOT.', 400);
        }

        const activeDoc = await prisma.manifestFiscalDocument.findFirst({ where: { manifestId: id, documentType: 'CIOT', status: 'AUTHORIZED' } });
        if (activeDoc) throw new AppError('Já existe um CIOT autorizado para este manifesto. Cancele antes de reemitir.', 409);

        const existingJob = await prisma.ciotEmissionJob.findFirst({ where: { manifestId: id }, orderBy: { createdAt: 'desc' } });
        if (existingJob && ['QUEUED', 'CADASTROS_ENSURING', 'SUBMITTED', 'POLLING'].includes(existingJob.phase)) {
            throw new AppError('Já existe uma emissão de CIOT em processamento para este manifesto.', 409);
        }

        const recipientAddress = body.requestData.destinatario.endereco;
        const recipientCity = await prisma.city.findUnique({ where: { ibgeCode: String(recipientAddress.codigoMunicipio) }, include: { state: true } });
        if (!recipientCity) throw new AppError('Selecione a cidade do destinatário pela busca ou pelo CEP.', 400);
        await validateSelectedAddress({ cep: recipientAddress.cep, city: recipientCity.name, state: recipientCity.state.code, cityIbgeCode: recipientCity.ibgeCode });

        const suggestion = await suggestCiotTipoViagem(id);
        const tipoViagem = body.tipoViagemOverride ?? manifest.ciotTipoViagemOverride ?? suggestion.tipoViagem;
        const contratantesCargaFracionada =
            tipoViagem === 'FRACIONADO' ? (body.contratantesCargaFracionada ?? suggestion.clientDocuments) : undefined;
        if (tipoViagem === 'FRACIONADO' && (!contratantesCargaFracionada || contratantesCargaFracionada.length < 1)) {
            throw new AppError('Fracionado exige ao menos 1 CNPJ em contratantesCargaFracionada.', 400);
        }
        if (tipoViagem === 'TAC_AGREGADO' && !contratadoRntrc) {
            throw new AppError('TAC_AGREGADO exige RNTRC do Contratante (FiscalEmitter do Hub).', 400);
        }

        if (body.tipoViagemOverride && body.tipoViagemOverride !== manifest.ciotTipoViagemOverride) {
            await prisma.manifest.update({ where: { id }, data: { ciotTipoViagemOverride: body.tipoViagemOverride } });
        }

        const requestData: StoredCiotRequestData = { ...body.requestData, contratantesCargaFracionada };

        let job: { id: string };
        if (existingJob && ['FAILED', 'PENDING_RECONCILIATION'].includes(existingJob.phase)) {
            // Retry da mesma tentativa — reusa o idOperacaoCliente (mesma linha, não cria nova).
            job = await prisma.ciotEmissionJob.update({
                where: { id: existingJob.id },
                data: { tipoViagem, requestData: requestData as object, phase: 'QUEUED', attemptCount: 0, lastError: null },
            });
        } else {
            const suffix = (await prisma.ciotEmissionJob.count({ where: { manifestId: id } })) + 1;
            job = await prisma.ciotEmissionJob.create({
                data: {
                    manifestId: id,
                    idOperacaoCliente: `CIOT-${id}-${suffix}`,
                    tipoViagem,
                    requestData: requestData as object,
                    environment: manifest.fiscalEmitter?.efreteEnvironment ?? 'HOMOLOGACAO',
                },
            });
        }

        await enqueueCiotEmissionJob({ ciotEmissionJobId: job.id });
        await prisma.ciotEmissionJob.update({ where: { id: job.id }, data: { queueJobId: job.id } });

        res.status(202).json({ success: true, data: job, message: 'Emissão de CIOT enfileirada.' });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// POST /api/manifests/:id/cancel-ciot-trip — cascata: Lotação cancela CIOT+MDF-e; Fracionado/TAC_Agregado só CIOT
router.post('/:id/cancel-ciot-trip', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const { justificativa } = req.body as { justificativa?: string };
        if (!justificativa) throw new AppError('justificativa is required', 400);

        const ciotDoc = await prisma.manifestFiscalDocument.findFirst({
            where: { manifestId: id, documentType: 'CIOT', status: 'AUTHORIZED' },
            orderBy: { createdAt: 'desc' },
        });
        if (!ciotDoc?.number) throw new AppError('Nenhum CIOT autorizado encontrado para este manifesto.', 404);

        const job = await prisma.ciotEmissionJob.findFirst({ where: { manifestId: id, phase: 'DONE' }, orderBy: { createdAt: 'desc' } });

        await cancelarCiot(ciotDoc.number, justificativa, ciotDoc.environment ?? job?.environment ?? null);
        await prisma.manifestFiscalDocument.update({
            where: { id: ciotDoc.id },
            data: { status: 'CANCELLED', cancelledAt: new Date(), statusReason: justificativa },
        });

        // Lotação não permite retificação de CIOT — erro força cancelar CIOT + MDF-e + reemitir os
        // dois. O cancelamento do MDF-e na SEFAZ (via ACBr) ainda não está implementado neste
        // repo (`acbrMdfeEmit.ts` só emite) — "Verdade Fiscal" proíbe marcar CANCELLED aqui sem
        // confirmação real do provider, então só sinalizamos a pendência pro operador resolver
        // pelo canal existente (console ACBr) até essa integração existir.
        let mdfeRequiresManualCancellation: { id: string; accessKey: string | null } | null = null;
        if (job?.tipoViagem === 'PADRAO') {
            const mdfeDoc = await prisma.manifestFiscalDocument.findFirst({
                where: { manifestId: id, documentType: 'MDFE', status: 'AUTHORIZED' },
                orderBy: { createdAt: 'desc' },
            });
            if (mdfeDoc) {
                await prisma.manifestFiscalDocument.update({
                    where: { id: mdfeDoc.id },
                    data: { statusReason: `AÇÃO NECESSÁRIA: cancelar este MDF-e na SEFAZ (cascata CIOT Lotação cancelado: ${justificativa}).` },
                });
                mdfeRequiresManualCancellation = { id: mdfeDoc.id, accessKey: mdfeDoc.accessKey };
            }
        }

        res.json({ success: true, message: 'CIOT cancelado.', mdfeRequiresManualCancellation });
    } catch (error) {
        next(error);
    }
});

export { router as manifestsRouter };
