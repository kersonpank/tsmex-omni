import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { upsertPersonForDriver, upsertPersonForLinkOwner } from '../services/personRoleSync.js';

const router = Router();

// POST /api/links - Admin/HUB direct creation (used by the manifest wizard's "+ Cadastrar
// novo motorista" shortcut). Nasce já APPROVED/active — quem está criando (admin ou o
// operador do hub) está validando o documento ali mesmo, mesmo padrão de authorize já usado
// em /:id/fiscal, /:id/drivers e /:id/owner-person. Autocadastro do motorista
// (LinkOnboardingWizard) continua passando por aprovação manual separada; essa rota não
// substitui aquele fluxo.
const createLinkSchema = z.object({
    document: z.string().min(11),
    name: z.string().min(1),
    phone: z.string().min(8),
    vehiclePlate: z.string().min(7).max(8),
    vehicleTypeId: z.string().uuid(),
    homeBase: z.string().optional(),
});
router.post('/', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const body = createLinkSchema.parse(req.body);

        const normalizedDoc = body.document.replace(/\D/g, '');
        if (normalizedDoc.length !== 11 && normalizedDoc.length !== 14) {
            throw new AppError('Document must be CPF (11 digits) or CNPJ (14 digits)', 400);
        }

        const existingLink = await prisma.link.findUnique({ where: { document: normalizedDoc } });
        if (existingLink) {
            throw new AppError('Já existe um Link cadastrado com este CPF/CNPJ.', 409);
        }

        const vehicleType = await prisma.vehicleType.findFirst({
            where: { id: body.vehicleTypeId, active: true },
            select: { id: true },
        });
        if (!vehicleType) {
            throw new AppError('Tipo de veículo não encontrado ou inativo.', 400);
        }

        const normalizedPlate = body.vehiclePlate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (normalizedPlate.length !== 7) {
            throw new AppError('Placa deve ter 7 caracteres alfanuméricos.', 400);
        }

        // Link.userId é obrigatório (1:1 com User) — criamos uma conta placeholder;
        // o motorista define login de verdade quando completar o próprio onboarding.
        const placeholderEmail = `link-${randomUUID()}@tsmex.internal`;
        const hashedPassword = await bcrypt.hash(randomUUID(), 10);

        const link = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: { email: placeholderEmail, password: hashedPassword, roles: ['LINK'], active: true },
            });
            return tx.link.create({
                data: {
                    userId: user.id,
                    name: body.name,
                    document: normalizedDoc,
                    phone: body.phone,
                    vehiclePlate: normalizedPlate,
                    vehicleTypeId: body.vehicleTypeId,
                    homeBase: body.homeBase || 'A completar',
                    coverageStates: [],
                    approvalStatus: 'APPROVED',
                    active: true,
                },
                include: { vehicleType: true },
            });
        });

        res.status(201).json({ success: true, data: link, message: 'Link cadastrado e aprovado.' });
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
                link: { active: true, approvalStatus: 'APPROVED' },
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
        if (!finalVehicleTypeId) {
            throw new AppError('vehicleTypeId is required when approving a link that has no vehicle type assigned', 400);
        }

        const vt = await prisma.vehicleType.findFirst({
            where: { id: finalVehicleTypeId, active: true },
        });
        if (!vt) {
            throw new AppError('Vehicle type not found or inactive', 400);
        }

        const link = await prisma.link.update({
            where: { id },
            data: {
                approvalStatus: 'APPROVED',
                active: true,
                vehicleTypeId: finalVehicleTypeId,
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
router.patch('/:id/fiscal', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const body = patchLinkFiscalSchema.parse(req.body);
        if (body.vehicleTypeId) {
            const vehicleType = await prisma.vehicleType.findFirst({ where: { id: body.vehicleTypeId, active: true }, select: { id: true } });
            if (!vehicleType) throw new AppError('Tipo de veículo não encontrado ou inativo.', 400);
        }
        const normalizePlate = (plate: string | null | undefined) =>
            typeof plate === 'string' ? plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : plate;
        for (const plate of [body.vehiclePlate, body.trailerPlate, body.trailer2Plate, body.trailer3Plate]) {
            const normalized = normalizePlate(plate);
            if (normalized && normalized.length !== 7) {
                throw new AppError('Cada placa deve ter 7 caracteres alfanuméricos.', 400);
            }
        }
        const link = await prisma.link.update({
            where: { id },
            data: {
                ...body,
                ...(body.vehiclePlate !== undefined ? { vehiclePlate: normalizePlate(body.vehiclePlate)! } : {}),
                ...(body.trailerPlate !== undefined ? { trailerPlate: normalizePlate(body.trailerPlate) } : {}),
                ...(body.trailer2Plate !== undefined ? { trailer2Plate: normalizePlate(body.trailer2Plate) } : {}),
                ...(body.trailer3Plate !== undefined ? { trailer3Plate: normalizePlate(body.trailer3Plate) } : {}),
            },
            include: { vehicleType: true },
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

        const drivers = await prisma.driver.findMany({ where: { linkId: id, active: true }, orderBy: { createdAt: 'asc' } });
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
    cityIbgeCode: z.string().min(7).optional(),
});

const driverSchema = z.object({
    name: z.string().min(1),
    document: z.string().min(11),
    phone: z.string().min(10),
    birthDate: z.string().optional(),
    cnhNumber: z.string().optional(),
    cnhExpiry: z.string().optional(),
    address: addressSchema.optional(),
});

router.post('/:id/drivers', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const link = await prisma.link.findUnique({ where: { id } });
        if (!link) throw new AppError('Link not found', 404);

        const body = driverSchema.parse(req.body);
        const normalizedDoc = body.document.replace(/\D/g, '');

        // Check if this CPF is already a Driver anywhere
        const existingDriver = await prisma.driver.findUnique({ where: { document: normalizedDoc } });

        if (existingDriver) {
            if (existingDriver.linkId !== id) {
                // CPF belongs to a driver on another Link — 409
                const ownerLink = await prisma.link.findUnique({
                    where: { id: existingDriver.linkId },
                    select: { name: true },
                });
                throw new AppError(
                    `CPF já cadastrado como motorista do Link "${ownerLink?.name ?? existingDriver.linkId}".`,
                    409,
                );
            }

            // Same link — update the existing driver record
            const { person, personAlreadyExists, notOverwritten } = await upsertPersonForDriver(
                normalizedDoc,
                body.name,
                body.address,
            );

            const driver = await prisma.driver.update({
                where: { id: existingDriver.id },
                data: {
                    name: body.name,
                    phone: body.phone,
                    ...(body.birthDate ? { birthDate: new Date(body.birthDate) } : {}),
                    ...(body.cnhNumber !== undefined ? { cnhNumber: body.cnhNumber } : {}),
                    ...(body.cnhExpiry ? { cnhExpiry: new Date(body.cnhExpiry) } : {}),
                    personId: person.id,
                },
            });

            return res.json({ success: true, data: driver, personAlreadyExists, notOverwritten });
        }

        // New driver — address is required to create Person
        if (!body.address) {
            throw new AppError('Endereço é obrigatório para cadastrar um motorista.', 400);
        }

        const { person, personAlreadyExists, notOverwritten } = await upsertPersonForDriver(
            normalizedDoc,
            body.name,
            body.address,
        );

        const driver = await prisma.driver.create({
            data: {
                linkId: id,
                name: body.name,
                document: normalizedDoc,
                phone: body.phone,
                birthDate: body.birthDate ? new Date(body.birthDate) : undefined,
                cnhNumber: body.cnhNumber,
                cnhExpiry: body.cnhExpiry ? new Date(body.cnhExpiry) : undefined,
                personId: person.id,
            },
        });

        return res.status(201).json({ success: true, data: driver, personAlreadyExists, notOverwritten });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

router.patch('/:id/drivers/:driverId', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id, driverId } = req.params as { id: string; driverId: string };
        const existing = await prisma.driver.findUnique({ where: { id: driverId } });
        if (!existing || existing.linkId !== id) throw new AppError('Driver not found for this link', 404);

        const body = driverSchema.partial().parse(req.body);

        let personId = existing.personId;
        let personAlreadyExists: boolean | undefined;
        let notOverwritten: string[] | undefined;

        if (body.address || (body.name && !existing.personId)) {
            const docToUse = body.document
                ? body.document.replace(/\D/g, '')
                : existing.document;
            const nameToUse = body.name ?? existing.name;
            const result = await upsertPersonForDriver(docToUse, nameToUse, body.address);
            personId = result.person.id;
            personAlreadyExists = result.personAlreadyExists;
            notOverwritten = result.notOverwritten;
        }

        const driver = await prisma.driver.update({
            where: { id: driverId },
            data: {
                ...(body.name !== undefined ? { name: body.name } : {}),
                ...(body.document !== undefined ? { document: body.document.replace(/\D/g, '') } : {}),
                ...(body.phone !== undefined ? { phone: body.phone } : {}),
                ...(body.birthDate !== undefined ? { birthDate: new Date(body.birthDate) } : {}),
                ...(body.cnhNumber !== undefined ? { cnhNumber: body.cnhNumber } : {}),
                ...(body.cnhExpiry !== undefined ? { cnhExpiry: new Date(body.cnhExpiry) } : {}),
                ...(personId !== existing.personId ? { personId } : {}),
            },
        });

        res.json({
            success: true,
            data: driver,
            ...(personAlreadyExists !== undefined ? { personAlreadyExists, notOverwritten } : {}),
        });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

// PATCH /api/links/:id/owner-person - Vincula/cria a Person do próprio Link (endereço + IE do proprietário),
// usada pelo "Gravar Proprietário" do CIOT. O documento nunca é redigitado: vem de Link.document.
const ownerPersonSchema = z.object({
    address: addressSchema.optional(),
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
        );

        const updated = await prisma.link.update({
            where: { id },
            data: { personId: person.id },
            include: { vehicleType: true },
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
