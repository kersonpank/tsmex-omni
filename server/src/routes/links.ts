import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { upsertPersonForDriver, upsertPersonForLinkOwner } from '../services/personRoleSync.js';
import { linkCompositionSchema, linkVehicleInclude, setLinkComposition } from '../services/vehicleUnitService.js';
import { normalizePlate, resolveComposition } from '../services/vehicleUnitRules.js';
import { isValidCpf, isValidCnpj, documentDigits } from '../services/documentValidation.js';
import { signLinkInvite } from '../services/linkInvite.js';
import { getObjectDownloadUrl, uploadBase64Object } from '../lib/objectStorage.js';

const router = Router();

// Cadastro comercial de transportador: nasce pendente e sem usuário de aplicativo.
const createLinkSchema = z.object({
    document: z.string().min(11),
    name: z.string().min(1),
    phone: z.string().min(8),
    vehiclePlate: z.string().min(7).max(8).optional(),
    vehicleTypeId: z.string().uuid().optional(),
    homeBase: z.string().optional(),
});
router.post('/', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const body = createLinkSchema.parse(req.body);

        const normalizedDoc = documentDigits(body.document);
        if (!(normalizedDoc.length === 11 ? isValidCpf(normalizedDoc) : normalizedDoc.length === 14 && isValidCnpj(normalizedDoc))) {
            throw new AppError('Informe um CPF ou CNPJ válido.', 400);
        }

        const existingLink = await prisma.link.findUnique({ where: { document: normalizedDoc } });
        if (existingLink) {
            throw new AppError('Já existe um Link cadastrado com este CPF/CNPJ.', 409);
        }

        if (body.vehicleTypeId) {
            const vehicleType = await prisma.vehicleType.findFirst({ where: { id: body.vehicleTypeId, active: true }, select: { id: true } });
            if (!vehicleType) throw new AppError('Tipo de veículo não encontrado ou inativo.', 400);
        }

        const normalizedPlate = body.vehiclePlate ? normalizePlate(body.vehiclePlate) : null;
        if (normalizedPlate && normalizedPlate.length !== 7) {
            throw new AppError('Placa deve ter 7 caracteres alfanuméricos.', 400);
        }

        const link = await prisma.$transaction(async (tx) => {
            const person = await tx.person.upsert({
                where: { document: normalizedDoc },
                create: { document: normalizedDoc, documentType: normalizedDoc.length === 11 ? 'CPF' : 'CNPJ', legalName: body.name.trim() },
                update: {},
            });
            return tx.link.create({
                data: {
                    personId: person.id,
                    name: body.name,
                    document: normalizedDoc,
                    phone: body.phone,
                    vehiclePlate: normalizedPlate,
                    vehicleTypeId: body.vehicleTypeId,
                    homeBase: body.homeBase || 'A completar',
                    coverageStates: [],
                    approvalStatus: 'PENDING',
                    active: false,
                },
                include: { vehicleType: true },
            });
        });

        res.status(201).json({ success: true, data: link, message: 'Transportador cadastrado. Falta aprovação e convite de acesso antes da oferta.' });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

// GET /api/links - List links (Admin: full; Hub: approved/active only for manifest assignment)
router.get('/', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { status, approvalStatus, state } = req.query;
        const isHubOnly =
            req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN');
        const statusFilter = (approvalStatus ?? status) as string | undefined;

        const where = {
            ...(isHubOnly
                ? { approvalStatus: 'APPROVED' as const, active: true }
                : statusFilter
                  ? { approvalStatus: statusFilter as 'PENDING' | 'APPROVED' | 'REJECTED' }
                  : {}),
            ...(state ? { coverageStates: { has: state as string } } : {}),
        };

        const links = isHubOnly
            ? await prisma.link.findMany({
                  where,
                  select: {
                      id: true,
                      name: true,
                      document: true,
                      phone: true,
                      vehiclePlate: true,
                      vehicleYear: true,
                      trailerPlate: true,
                      trailer2Plate: true,
                      trailer3Plate: true,
                      vehicleAxles: true,
                      vehicleTypeId: true,
                      rntrc: true,
                      carrierType: true,
                      vehicleOwnerDocument: true,
                      vehicleOwnerName: true,
                      vehicleChassi: true,
                      vehicleRenavam: true,
                      vehicleBodyType: true,
                      vehicleWheelType: true,
                      approvalStatus: true,
                      active: true,
                      vehicleType: true,
                      ...linkVehicleInclude,
                  },
                  orderBy: { createdAt: 'desc' },
              })
            : await prisma.link.findMany({
                  where,
                  include: {
                      user: {
                          select: { email: true, active: true },
                      },
                      vehicleType: true,
                      ...linkVehicleInclude,
                      onboarding: true,
                      _count: {
                          select: { manifests: true },
                      },
                  },
                  orderBy: { createdAt: 'desc' },
              });

        res.json({
            success: true,
            data: links,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/links/pending - List pending approvals
router.get('/pending', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const links = await prisma.link.findMany({
            where: { approvalStatus: 'PENDING' },
            include: {
                user: {
                    select: { email: true }
                },
                vehicleType: true,
            },
            orderBy: { createdAt: 'asc' },
        });

        res.json({
            success: true,
            data: links,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/links/drivers/search?q= - Busca operacional global por nome/CPF.
// O vínculo com o Link retorna junto para manter motorista, responsável e veículo consistentes.
router.get('/drivers/search', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const query = String(req.query.q ?? '').trim();
        const documentQuery = query.replace(/\D/g, '');
        const drivers = await prisma.driver.findMany({
            where: {
                active: true,
                ...(query
                    ? {
                          OR: [
                              { name: { contains: query, mode: 'insensitive' as const } },
                              ...(documentQuery ? [{ document: { contains: documentQuery } }] : []),
                          ],
                      }
                    : {}),
            },
            include: {
                link: {
                    include: { vehicleType: true },
                },
                carriers: { where: { active: true }, select: { linkId: true } },
            },
            orderBy: { name: 'asc' },
            take: 50,
        });
        res.json({ success: true, data: drivers });
    } catch (error) {
        next(error);
    }
});

// GET /api/links/:id
router.post('/:id/invite', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const link = await prisma.link.findUnique({ where: { id: req.params.id as string }, select: { id: true, userId: true, approvalStatus: true } });
        if (!link) throw new AppError('Transportador não encontrado.', 404);
        if (link.approvalStatus !== 'APPROVED') throw new AppError('Aprove o cadastro comercial antes de convidar o transportador.', 409);
        if (link.userId) throw new AppError('O transportador já possui acesso ao aplicativo.', 409);
        res.json({ success: true, data: { token: signLinkInvite(link.id), expiresInDays: 7 } });
    } catch (error) { next(error); }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        // Links can only view their own profile
        if (req.user!.roles.includes('LINK')) {
            const link = await prisma.link.findFirst({
                where: { userId: req.user!.id }
            });
            if (!link || link.id !== id) {
                throw new AppError('Not authorized', 403);
            }
        }

        const link = await prisma.link.findUnique({
            where: { id: id },
            include: {
                user: {
                    select: { email: true, active: true }
                },
                vehicleType: true,
                onboarding: true,
            }
        });

        if (!link) {
            throw new AppError('Link not found', 404);
        }

        res.json({
            success: true,
            data: link,
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/links/:id - Update own link profile (LINK only: name, document, phone, vehiclePlate, homeBase)
const patchLinkSchema = z.object({
    name: z.string().min(1).optional(),
    document: z.string().optional(),
    phone: z.string().optional(),
    vehiclePlate: z.string().optional(),
    homeBase: z.string().optional(),
});
router.patch('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        if (!req.user!.roles.includes('LINK')) {
            throw new AppError('Only LINK can update own profile via this endpoint', 403);
        }
        const myLink = await prisma.link.findFirst({
            where: { userId: req.user!.id },
            include: { person: true },
        });
        if (!myLink || myLink.id !== id) {
            throw new AppError('Not authorized', 403);
        }
        const body = patchLinkSchema.parse(req.body);
        const updates: { name?: string; document?: string; phone?: string; vehiclePlate?: string; homeBase?: string; personId?: string } = {};
        if (body.name !== undefined) updates.name = body.name;
        if (body.phone !== undefined) updates.phone = body.phone;
        if (body.vehiclePlate !== undefined) updates.vehiclePlate = body.vehiclePlate;
        if (body.homeBase !== undefined) updates.homeBase = body.homeBase;

        if (body.document !== undefined) {
            const normalized = body.document.replace(/\D/g, '');
            if (normalized.length !== 11 && normalized.length !== 14) {
                throw new AppError('Document must be CPF (11 digits) or CNPJ (14 digits)', 400);
            }
            updates.document = normalized;
            const isPending = myLink.document.startsWith('PENDING-');
            if (isPending && myLink.personId) {
                await prisma.person.update({
                    where: { id: myLink.personId },
                    data: { document: normalized, legalName: body.name ?? myLink.name },
                });
            } else if (!isPending) {
                const existing = await prisma.person.findUnique({ where: { document: normalized } });
                if (existing && existing.id !== myLink.personId) {
                    throw new AppError('Document already registered', 400);
                }
                if (myLink.personId) {
                    await prisma.person.update({
                        where: { id: myLink.personId },
                        data: { document: normalized, legalName: body.name ?? myLink.name },
                    });
                }
            }
        }

        const link = await prisma.link.update({
            where: { id },
            data: updates,
            include: { vehicleType: true, onboarding: true },
        });
        res.json({ success: true, data: link });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

const onboardingSchema = z.object({
    documentsPersonal: z.record(z.any()).optional(),
    documentsCavalo: z.record(z.any()).optional(), // may include ownerIsDriver: boolean
    documentsCarreta: z.record(z.any()).optional(), // may include ownerIsDriver: boolean
    contactsPersonal: z.array(z.object({ name: z.string(), phone: z.string(), relation: z.string().optional() })).optional(),
    contactsProfessional: z.array(z.object({ name: z.string(), phone: z.string(), companyOrRole: z.string().optional() })).optional(),
    vehiclePhotos: z.array(z.object({ url: z.string(), label: z.string().optional() })).optional(),
    bankData: z.record(z.any()).optional(), // may include pixKey, pixKeyType
    hasTrailer: z.boolean().optional(),
    complete: z.boolean().optional(), // when true, mark onboardingComplete
});

// PUT /api/links/:id/onboarding - Create or update onboarding data (Link own profile or Admin)
router.put('/:id/onboarding', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        if (req.user!.roles.includes('LINK')) {
            const myLink = await prisma.link.findFirst({
                where: { userId: req.user!.id },
                select: { id: true },
            });
            if (!myLink || myLink.id !== id) {
                throw new AppError('Not authorized to update this link onboarding', 403);
            }
        } else if (!req.user!.roles.includes('ADMIN')) {
            throw new AppError('Not authorized', 403);
        }

        const link = await prisma.link.findUnique({ where: { id }, select: { id: true } });
        if (!link) {
            throw new AppError('Link not found', 404);
        }

        const body = onboardingSchema.parse(req.body);
        const complete = body.complete === true;
        const { complete: _complete, ...rest } = body as { complete?: boolean; [k: string]: unknown };

        const data: Record<string, unknown> = {};
        if (rest.documentsPersonal !== undefined) data.documentsPersonal = rest.documentsPersonal;
        if (rest.documentsCavalo !== undefined) data.documentsCavalo = rest.documentsCavalo;
        if (rest.documentsCarreta !== undefined) data.documentsCarreta = rest.documentsCarreta;
        if (rest.contactsPersonal !== undefined) data.contactsPersonal = rest.contactsPersonal;
        if (rest.contactsProfessional !== undefined) data.contactsProfessional = rest.contactsProfessional;
        if (rest.vehiclePhotos !== undefined) data.vehiclePhotos = rest.vehiclePhotos;
        if (rest.bankData !== undefined) data.bankData = rest.bankData;
        if (rest.hasTrailer !== undefined) data.hasTrailer = rest.hasTrailer;

        const onboarding = await prisma.linkOnboarding.upsert({
            where: { linkId: id },
            create: {
                linkId: id,
                ...data,
                onboardingComplete: complete,
            } as any,
            update: {
                ...data,
                ...(complete ? { onboardingComplete: true } : {}),
            } as any,
        });

        res.json({
            success: true,
            data: onboarding,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// PATCH /api/links/:id/approve - Approve link (Admin only); body: { vehicleTypeId } required when link has no vehicleTypeId
router.patch('/:id/approve', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const { vehicleTypeId } = req.body || {};

        const existing = await prisma.link.findUnique({
            where: { id },
            select: { vehicleTypeId: true },
        });
        if (!existing) {
            return next(new AppError('Link not found', 404));
        }

        const finalVehicleTypeId = vehicleTypeId ?? existing.vehicleTypeId;
        if (finalVehicleTypeId) {
            const vt = await prisma.vehicleType.findFirst({ where: { id: finalVehicleTypeId, active: true } });
            if (!vt) throw new AppError('Vehicle type not found or inactive', 400);
        }

        const link = await prisma.link.update({
            where: { id },
            data: {
                approvalStatus: 'APPROVED',
                active: true,
                vehicleTypeId: finalVehicleTypeId ?? null,
            },
            include: {
                vehicleType: true,
                user: { select: { email: true } },
            },
        });

        res.json({
            success: true,
            data: link,
            message: 'Link approved successfully',
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/links/:id/reject - Reject link (Admin only)
router.patch('/:id/reject', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const { reason } = req.body;

        const link = await prisma.link.update({
            where: { id: id },
            data: {
                approvalStatus: 'REJECTED',
                active: false,
            },
        });

        // TODO: Send WhatsApp notification with reason

        res.json({
            success: true,
            data: link,
            message: 'Link rejected',
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/links/:id/fiscal - Dados CIOT/ANTT do transportador contratado (Admin ou HUB)
const patchLinkFiscalSchema = z.object({
    vehicleTypeId: z.string().uuid().optional(),
    vehiclePlate: z.string().min(7).max(8).optional(),
    vehicleYear: z.number().int().min(1950).max(new Date().getFullYear() + 1).nullable().optional(),
    rntrc: z.string().min(8).max(9).optional(),
    carrierType: z.enum(['TAC', 'ETC', 'CTC', 'FROTA']).optional(),
    trailerPlate: z.string().min(7).max(8).nullable().optional(),
    trailer2Plate: z.string().min(7).max(8).nullable().optional(),
    trailer3Plate: z.string().min(7).max(8).nullable().optional(),
    vehicleAxles: z.number().int().positive().optional(),
    vehicleOwnerDocument: z.string().optional(),
    vehicleOwnerName: z.string().optional(),
    vehicleChassi: z.string().length(17).optional(),
    vehicleRenavam: z.string().optional(),
    vehicleBodyType: z.enum(['NaoAplicavel', 'Aberta', 'FechadaOuBau', 'Granelera', 'PortaContainer', 'Sider']).optional(),
    vehicleWheelType: z.enum(['NaoAplicavel', 'Truck', 'Toco', 'Cavalo']).optional(),
});
const VEHICLE_FIELD_KEYS = [
    'vehiclePlate', 'vehicleYear', 'rntrc', 'trailerPlate', 'trailer2Plate', 'trailer3Plate', 'vehicleAxles',
    'vehicleOwnerDocument', 'vehicleOwnerName', 'vehicleChassi', 'vehicleRenavam', 'vehicleBodyType', 'vehicleWheelType',
] as const;

// PUT /api/links/:id/composition - Composição veicular por unidades (cavalo + até 3 reboques).
// Cada placa vira/atualiza uma VehicleUnit reutilizável; o Link só referencia as unidades.
router.put('/:id/composition', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const body = linkCompositionSchema.parse(req.body);
        const link = await setLinkComposition(req.params.id as string, body);
        res.json({ success: true, data: link });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

router.patch('/:id/fiscal', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const body = patchLinkFiscalSchema.parse(req.body);
        if (body.vehicleTypeId) {
            const vehicleType = await prisma.vehicleType.findFirst({ where: { id: body.vehicleTypeId, active: true }, select: { id: true } });
            if (!vehicleType) throw new AppError('Tipo de veículo não encontrado ou inativo.', 400);
        }
        for (const plate of [body.vehiclePlate, body.trailerPlate, body.trailer2Plate, body.trailer3Plate]) {
            const normalized = normalizePlate(plate);
            if (normalized && normalized.length !== 7) {
                throw new AppError('Cada placa deve ter 7 caracteres alfanuméricos.', 400);
            }
        }

        const existing = await prisma.link.findUnique({ where: { id }, include: linkVehicleInclude });
        if (!existing) throw new AppError('Link not found', 404);

        // Dados de veículo (placa, chassi, RENAVAM, eixos, RNTRC, reboques, dono) moram nas
        // VehicleUnit; este endpoint legado só traduz o payload para a composição do Link.
        const touchesVehicle = VEHICLE_FIELD_KEYS.some((key) => body[key] !== undefined);
        if (touchesVehicle) {
            const current = resolveComposition(existing);
            const tractionPlate = body.vehiclePlate ?? current.traction?.plate;
            if (!tractionPlate) throw new AppError('Informe a placa principal (cavalo) da composição.', 400);
            const trailerSlots = [body.trailerPlate, body.trailer2Plate, body.trailer3Plate];
            const trailerPlates = trailerSlots
                .map((slot, i) => (slot !== undefined ? slot : current.trailers[i]?.plate))
                .filter((plate): plate is string => Boolean(plate));
            const composition = linkCompositionSchema.parse({
                traction: {
                    plate: tractionPlate,
                    chassi: body.vehicleChassi,
                    renavam: body.vehicleRenavam,
                    axles: body.vehicleAxles,
                    rntrc: body.rntrc,
                    bodyType: body.vehicleBodyType,
                    wheelType: body.vehicleWheelType,
                    year: body.vehicleYear,
                    ownerDocument: body.vehicleOwnerDocument,
                    ownerName: body.vehicleOwnerName,
                },
                trailers: trailerPlates.map((plate) => ({ plate })),
            });
            await setLinkComposition(id, composition);
        }

        const link = await prisma.link.update({
            where: { id },
            data: {
                ...(body.vehicleTypeId !== undefined ? { vehicleTypeId: body.vehicleTypeId } : {}),
                ...(body.carrierType !== undefined ? { carrierType: body.carrierType } : {}),
            },
            include: { vehicleType: true, ...linkVehicleInclude },
        });
        res.json({ success: true, data: link });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

// GET /api/links/:id/drivers - Consulta somente leitura dos motoristas do Link.
// O cadastro acontece explicitamente no fluxo do manifesto, sem efeito colateral nesta busca.
router.get('/:id/drivers', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const link = await prisma.link.findUnique({ where: { id } });
        if (!link) throw new AppError('Link not found', 404);

        const drivers = await prisma.driver.findMany({ where: { active: true, OR: [{ linkId: id }, { carriers: { some: { linkId: id, active: true } } }] }, orderBy: { createdAt: 'asc' } });
        res.json({ success: true, data: drivers });
    } catch (error) {
        next(error);
    }
});

const addressSchema = z.object({
    cep: z.string().min(8),
    address: z.string().min(1),
    number: z.string().min(1),
    complement: z.string().optional(),
    neighborhood: z.string().min(1),
    city: z.string().min(1),
    state: z.string().length(2),
    cityIbgeCode: z.string({ required_error: 'Selecione a cidade na busca ou consulte o CEP.' }).regex(/^\d{7}$/, 'Selecione uma cidade válida com código IBGE.'),
});

const driverSchema = z.object({
    name: z.string().min(1),
    document: z.string().refine(isValidCpf, 'Informe um CPF válido para o motorista.'),
    phone: z.string().min(10, 'Informe o telefone do motorista com DDD (pelo menos 10 dígitos).'),
    birthDate: z.string().optional(),
    cnhNumber: z.string().optional(),
    cnhExpiry: z.string().optional(),
    cnhRegistry: z.string().optional(),
    cnhState: z.string().length(2).optional(),
    cnhIssuedAt: z.string().optional(),
    cnhFirstIssuedAt: z.string().optional(),
    cnhCategory: z.string().max(5).optional(),
    toxicologyExpiry: z.string().optional(),
    blockedReason: z.string().max(2000).nullable().optional(),
    birthCity: z.string().optional(),
    birthState: z.string().length(2).optional(),
    identityNumber: z.string().optional(),
    maritalStatus: z.string().optional(),
    pis: z.string().optional(),
    notes: z.string().optional(),
    contacts: z.array(z.object({ name: z.string().min(1), phone: z.string().optional(), email: z.string().email().optional(), relation: z.string().optional() })).optional(),
    paymentAccount: z.object({ bankCode: z.string().optional(), accountType: z.string().optional(), agency: z.string().optional(), account: z.string().optional(), pixKey: z.string().optional() }).optional(),
    address: addressSchema.optional(),
    updatePersonAddress: z.boolean().optional(),
});

async function assertHubDriverLinkAccess(req: AuthRequest, linkId: string) {
    if (req.user!.roles.includes('ADMIN')) return;
    if (!req.user!.hubId) throw new AppError('Acesso à ficha do motorista não autorizado.', 404);
    const assigned = await prisma.manifest.findFirst({
        where: { linkId, hubId: req.user!.hubId }, select: { id: true },
    });
    if (!assigned) throw new AppError('Acesso à ficha do motorista não autorizado.', 404);
}

router.get('/:id/drivers/:driverId', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id, driverId } = req.params as { id: string; driverId: string };
        await assertHubDriverLinkAccess(req, id);
        const driver = await prisma.driver.findFirst({
            where: { id: driverId, OR: [{ linkId: id }, { carriers: { some: { linkId: id, active: true } } }] },
            include: { person: { include: { individualProfile: true, contacts: true, paymentAccounts: { where: { isPrimary: true } } } }, carriers: { where: { active: true } } },
        });
        if (!driver) throw new AppError('Motorista não encontrado para este transportador.', 404);
        const photoKey = driver.person?.individualProfile?.photoStorageKey;
        const photoUrl = photoKey ? await getObjectDownloadUrl(photoKey).catch(() => null) : null;
        res.json({ success: true, data: { ...driver, photoUrl } });
    } catch (error) { next(error); }
});

async function saveDriverDetails(tx: Prisma.TransactionClient, personId: string, driverId: string, body: Partial<z.infer<typeof driverSchema>>) {
    const individual = {
        birthCity: body.birthCity, birthState: body.birthState, identityNumber: body.identityNumber,
        maritalStatus: body.maritalStatus, pis: body.pis, notes: body.notes,
    };
    if (Object.values(individual).some((value) => value !== undefined)) {
        await tx.personIndividualProfile.upsert({ where: { personId }, create: { personId, ...individual }, update: individual });
    }
    if (body.contacts) {
        await tx.personContact.deleteMany({ where: { personId } });
        if (body.contacts.length) await tx.personContact.createMany({ data: body.contacts.map((contact) => ({ ...contact, personId })) });
    }
    if (body.paymentAccount) {
        const current = await tx.personPaymentAccount.findFirst({ where: { personId, isPrimary: true } });
        if (current) await tx.personPaymentAccount.update({ where: { id: current.id }, data: body.paymentAccount });
        else await tx.personPaymentAccount.create({ data: { personId, ...body.paymentAccount, isPrimary: true } });
    }
    const driverFields = {
        cnhRegistry: body.cnhRegistry, cnhState: body.cnhState, cnhCategory: body.cnhCategory,
        cnhIssuedAt: body.cnhIssuedAt ? new Date(body.cnhIssuedAt) : undefined,
        cnhFirstIssuedAt: body.cnhFirstIssuedAt ? new Date(body.cnhFirstIssuedAt) : undefined,
        toxicologyExpiry: body.toxicologyExpiry ? new Date(body.toxicologyExpiry) : undefined,
        blockedReason: body.blockedReason,
    };
    if (Object.values(driverFields).some((value) => value !== undefined)) {
        await tx.driver.update({ where: { id: driverId }, data: driverFields });
    }
}

router.post('/:id/drivers', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        await assertHubDriverLinkAccess(req, id);
        const link = await prisma.link.findUnique({ where: { id } });
        if (!link) throw new AppError('Link not found', 404);

        const body = driverSchema.parse(req.body);
        const normalizedDoc = documentDigits(body.document);

        // Check if this CPF is already a Driver anywhere
        const existingDriver = await prisma.driver.findUnique({ where: { document: normalizedDoc } });

        if (existingDriver) {
            // Reuse the canonical CPF across carriers; never reassign the legacy owner link.
            const result = await prisma.$transaction(async (tx) => {
                const personResult = await upsertPersonForDriver(normalizedDoc, body.name, body.address, body.updatePersonAddress, tx);
                const driver = await tx.driver.update({
                    where: { id: existingDriver.id },
                    data: { name: personResult.notOverwritten.includes('legalName') ? existingDriver.name : body.name,
                        phone: body.phone, ...(body.birthDate ? { birthDate: new Date(body.birthDate) } : {}),
                        ...(body.cnhNumber !== undefined ? { cnhNumber: body.cnhNumber } : {}),
                        ...(body.cnhExpiry ? { cnhExpiry: new Date(body.cnhExpiry) } : {}),
                        ...(body.blockedReason !== undefined && body.blockedReason !== existingDriver.blockedReason ? { active: !Boolean(body.blockedReason) } : {}),
                        personId: personResult.person.id },
                    include: { person: true },
                });
                await tx.driverCarrier.upsert({ where: { driverId_linkId: { driverId: driver.id, linkId: id } }, create: { driverId: driver.id, linkId: id }, update: { active: true } });
                await saveDriverDetails(tx, personResult.person.id, driver.id, body);
                return { driver, ...personResult };
            });
            return res.json({ success: true, data: result.driver, personAlreadyExists: result.personAlreadyExists, notOverwritten: result.notOverwritten, message: 'Motorista reutilizado e associado ao transportador selecionado.' });
        }

        // New driver — address is required to create Person
        const result = await prisma.$transaction(async (tx) => {
            const personResult = await upsertPersonForDriver(normalizedDoc, body.name, body.address, body.updatePersonAddress, tx);
            const driver = await tx.driver.create({
                data: { linkId: id, name: body.name, document: normalizedDoc, phone: body.phone,
                    active: !Boolean(body.blockedReason),
                    birthDate: body.birthDate ? new Date(body.birthDate) : undefined,
                    cnhNumber: body.cnhNumber, cnhExpiry: body.cnhExpiry ? new Date(body.cnhExpiry) : undefined,
                    personId: personResult.person.id }, include: { person: true },
            });
            await tx.driverCarrier.create({ data: { driverId: driver.id, linkId: id } });
            await saveDriverDetails(tx, personResult.person.id, driver.id, body);
            return { driver, ...personResult };
        });

        return res.status(201).json({ success: true, data: result.driver, personAlreadyExists: result.personAlreadyExists, notOverwritten: result.notOverwritten });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

router.patch('/:id/drivers/:driverId', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id, driverId } = req.params as { id: string; driverId: string };
        await assertHubDriverLinkAccess(req, id);
        const existing = await prisma.driver.findUnique({ where: { id: driverId } });
        if (!existing || (existing.linkId !== id && !await prisma.driverCarrier.findUnique({ where: { driverId_linkId: { driverId, linkId: id } } }))) throw new AppError('Driver not found for this link', 404);

        const body = driverSchema.partial().parse(req.body);
        if (body.document && documentDigits(body.document) !== existing.document) throw new AppError('O CPF identifica a pessoa. Corrija o cadastro da pessoa antes de alterar o documento.', 409);

        const result = await prisma.$transaction(async (tx) => {
            const personResult = body.address || (body.name && !existing.personId)
                ? await upsertPersonForDriver(existing.document, body.name ?? existing.name, body.address, body.updatePersonAddress, tx)
                : null;
            const personId = personResult?.person.id ?? existing.personId;
            const driver = await tx.driver.update({
                where: { id: driverId },
                data: {
                    ...(body.name !== undefined ? { name: body.name } : {}),
                    ...(body.phone !== undefined ? { phone: body.phone } : {}),
                    ...(body.birthDate !== undefined ? { birthDate: new Date(body.birthDate) } : {}),
                    ...(body.cnhNumber !== undefined ? { cnhNumber: body.cnhNumber } : {}),
                    ...(body.cnhExpiry !== undefined ? { cnhExpiry: new Date(body.cnhExpiry) } : {}),
                    ...(body.blockedReason !== undefined && body.blockedReason !== existing.blockedReason ? { active: !Boolean(body.blockedReason) } : {}),
                    ...(personId !== existing.personId ? { personId } : {}),
                },
                include: { person: true },
            });
            if (personId) await saveDriverDetails(tx, personId, driverId, body);
            return { driver, personResult };
        });

        res.json({
            success: true,
            data: result.driver,
            ...(result.personResult ? { personAlreadyExists: result.personResult.personAlreadyExists, notOverwritten: result.personResult.notOverwritten } : {}),
        });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

// A foto é enviada por esta rota (nunca como storageKey livre no corpo da ficha), para que só
// objetos gravados aqui, no prefixo do próprio motorista, possam ser vinculados ao cadastro.
const driverPhotoSchema = z.object({
    base64: z.string().min(1, 'Envie a imagem da foto.').max(7_000_000, 'A foto deve ter no máximo 5 MB.'),
    fileName: z.string().min(1).max(200),
    mimeType: z.string().regex(/^image\/(jpeg|png|webp)$/, 'A foto deve ser JPG, PNG ou WEBP.'),
});

router.post('/:id/drivers/:driverId/photo', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id, driverId } = req.params as { id: string; driverId: string };
        await assertHubDriverLinkAccess(req, id);
        const driver = await prisma.driver.findFirst({
            where: { id: driverId, OR: [{ linkId: id }, { carriers: { some: { linkId: id, active: true } } }] },
            select: { id: true, personId: true },
        });
        if (!driver) throw new AppError('Motorista não encontrado para este transportador.', 404);
        if (!driver.personId) throw new AppError('Salve os dados pessoais do motorista antes de enviar a foto.', 409);

        const body = driverPhotoSchema.parse(req.body);
        const uploaded = await uploadBase64Object({ base64: body.base64, fileName: body.fileName, mimeType: body.mimeType, keyPrefix: `drivers/${driver.id}/photo` });
        await prisma.personIndividualProfile.upsert({
            where: { personId: driver.personId },
            create: { personId: driver.personId, photoStorageKey: uploaded.storageKey },
            update: { photoStorageKey: uploaded.storageKey },
        });
        res.status(201).json({ success: true, data: { photoUrl: uploaded.signedUrl } });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

router.post('/:id/drivers/:driverId/associate', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id, driverId } = req.params as { id: string; driverId: string };
        await assertHubDriverLinkAccess(req, id);
        const [link, driver] = await Promise.all([
            prisma.link.findUnique({ where: { id }, select: { id: true } }),
            prisma.driver.findUnique({ where: { id: driverId }, select: { id: true, active: true } }),
        ]);
        if (!link || !driver?.active) throw new AppError('Transportador ou motorista não encontrado.', 404);
        const association = await prisma.driverCarrier.upsert({ where: { driverId_linkId: { driverId, linkId: id } }, create: { driverId, linkId: id }, update: { active: true } });
        res.json({ success: true, data: association, message: 'Motorista vinculado ao transportador para esta viagem.' });
    } catch (error) { next(error); }
});

// PATCH /api/links/:id/owner-person - Vincula/cria a Person do próprio Link (endereço + IE do proprietário),
// usada pelo "Gravar Proprietário" do CIOT. O documento nunca é redigitado: vem de Link.document.
const ownerPersonSchema = z.object({
    address: addressSchema.optional(),
    updatePersonAddress: z.boolean().optional(),
    stateRegistration: z.string().optional(),
    legalName: z.string().min(1).optional(),
});
router.patch('/:id/owner-person', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const link = await prisma.link.findUnique({ where: { id } });
        if (!link) throw new AppError('Link not found', 404);

        const body = ownerPersonSchema.parse(req.body);
        const normalizedDoc = (link.document ?? '').replace(/\D/g, '');
        if (normalizedDoc.length !== 11 && normalizedDoc.length !== 14) {
            throw new AppError('Link ainda não tem um CPF/CNPJ válido cadastrado.', 400);
        }
        const documentType = normalizedDoc.length === 14 ? 'CNPJ' : 'CPF';

        const { person, personAlreadyExists, notOverwritten } = await upsertPersonForLinkOwner(
            documentType,
            normalizedDoc,
            body.legalName ?? link.name,
            body.address,
            body.stateRegistration,
            body.updatePersonAddress,
        );

        const updated = await prisma.link.update({
            where: { id },
            data: { personId: person.id },
            include: { vehicleType: true, person: true },
        });

        res.json({ success: true, data: updated, personAlreadyExists, notOverwritten });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

// GET /api/links/:id/manifests - Get link's manifests
router.get('/:id/manifests', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const status = req.query.status as string | undefined;

        // Links can only view their own manifests
        if (req.user!.roles.includes('LINK')) {
            const link = await prisma.link.findFirst({
                where: { userId: req.user!.id }
            });
            if (!link || link.id !== id) {
                throw new AppError('Not authorized', 403);
            }
        }

        const manifests = await prisma.manifest.findMany({
            where: {
                linkId: id,
                ...(status ? { status: status as any } : {}),
            },
            include: {
                vehicleType: true,
                hub: true,
                _count: {
                    select: { legs: true }
                }
            },
            orderBy: { createdAt: 'desc' },
        });

        const manifestsMapped = manifests.map((m) => {
            const { _count, ...rest } = m;
            return {
                ...rest,
                _count: _count ? { demands: _count.legs } : undefined
            };
        });

        res.json({
            success: true,
            data: manifestsMapped,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/links/available - Get available links for assignment
router.get('/available/for-assignment', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { vehicleTypeId, state } = req.query;

        const links = await prisma.link.findMany({
            where: {
                approvalStatus: 'APPROVED',
                active: true,
                ...(vehicleTypeId ? { vehicleTypeId: vehicleTypeId as string } : {}),
                ...(state ? { coverageStates: { has: state as string } } : {}),
            },
            include: {
                vehicleType: true,
            },
            orderBy: { score: 'desc' },
        });

        res.json({
            success: true,
            data: links,
        });
    } catch (error) {
        next(error);
    }
});

export { router as linksRouter };
