import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { resolveIbgeCode } from '../services/acbr/acbrIbge.js';

const router = Router();

function normalizeDocument(doc: string): string {
    return doc.replace(/\D/g, '');
}

function inferDocumentType(doc: string): 'CPF' | 'CNPJ' {
    const digits = normalizeDocument(doc);
    return digits.length === 11 ? 'CPF' : 'CNPJ';
}

// Validation schema
const hubSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    code: z.string().min(1, 'Code is required'),
    city: z.string().min(1, 'City is required'),
    state: z.string().length(2, 'State must be 2 characters'),
    personId: z.string().uuid().optional(),
    address: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    coverageCities: z.array(z.string()).default([]),
    coverageRadius: z.number().optional(),
    storageCapacity: z.number().optional(),
    dailyThroughput: z.number().optional(),
    managerName: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    canOrchestrate: z.boolean().default(false),
    active: z.boolean().default(true),
    // Fiscal / emissao CT-e e Minuta
    rntrc: z.string().optional().nullable(),
    lastCteNumber: z.number().int().min(0).optional(),
    lastMinutaNumber: z.number().int().min(0).optional(),
    simplesNacional: z.boolean().optional().nullable(),
    cityIbgeCode: z.string().optional().nullable(),
});

const addHubUserSchema = z.object({
    document: z.string().min(1, 'Documento (CPF/CNPJ) é obrigatório'),
    legalName: z.string().min(1, 'Nome ou razão social é obrigatório'),
    email: z.string().email('Email inválido'),
    password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
    permissions: z.array(z.string()).optional().default([]),
});

const entradaHubSchema = z.object({
    clientId: z.string().uuid(),
    nfNumber: z.string().min(1, 'NF number is required'),
    nfValue: z.number().positive('NF value must be positive'),
    origin: z.string().min(1, 'Origin is required'),
    destination: z.string().min(1, 'Destination is required'),
    commodity: z.string().min(1, 'Commodity is required'),
    weight: z.number().positive('Weight must be positive'),
    volume: z.number().positive('Volume must be positive'),
    units: z.number().int().positive().default(1),
    riskClass: z.enum(['A', 'B', 'C']).default('B'),
});

// GET /api/hubs - List all hubs (HUB user sees only their hub)
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { active, state } = req.query;

        const where: any = {
            ...(active !== undefined ? { active: active === 'true' } : {}),
            ...(state ? { state: state as string } : {}),
        };

        // Hub vê o diretório completo de hubs (todos pertencem à mesma transportadora TSM,
        // não é fronteira multi-tenant) — precisa disso pra escolher hub destino ao criar uma
        // viagem TRANSFER. A restrição por hubId é só pras entidades operacionais do próprio
        // hub (pedidos, manifestos, demandas), não pro diretório de hubs em si.

        const hubs = await prisma.hub.findMany({
            where,
            orderBy: { name: 'asc' },
            include: {
                person: { select: { id: true, document: true, legalName: true } },
            },
        });

        res.json({
            success: true,
            data: hubs,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/hubs/entrada - Registrar entrada de mercadoria no hub (HUB user only)
router.post('/entrada', authenticate, authorize('HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        if (!req.user!.hubId) {
            throw new AppError('Hub user has no hub assigned', 403);
        }

        const data = entradaHubSchema.parse(req.body);

        const client = await prisma.client.findUnique({
            where: { id: data.clientId },
        });
        if (!client) {
            throw new AppError('Client not found', 404);
        }

        const hub = await prisma.hub.findUnique({
            where: { id: req.user!.hubId! },
        });
        if (!hub || !hub.active) {
            throw new AppError('Hub not found or inactive', 404);
        }

        const result = await prisma.$transaction(async (tx) => {
            const demand = await tx.demand.create({
                data: {
                    clientId: data.clientId,
                    nfNumber: data.nfNumber,
                    nfValue: data.nfValue,
                    origin: data.origin,
                    destination: data.destination,
                    commodity: data.commodity,
                    weight: data.weight,
                    volume: data.volume,
                    units: data.units,
                    riskClass: data.riskClass as 'A' | 'B' | 'C',
                    intentType: 'DROP_AT_HUB',
                    status: 'CONVERTED',
                    sourceType: 'FORM',
                },
            });

            await tx.demandEvent.create({
                data: {
                    demandId: demand.id,
                    status: 'CONVERTED',
                    description: 'Entrada registrada no hub',
                    location: hub.city + ', ' + hub.state,
                },
            });

            const order = await tx.order.create({
                data: {
                    demandId: demand.id,
                    nfNumber: demand.nfNumber,
                    status: 'AT_HUB',
                    currentHubId: req.user!.hubId!,
                    enteredAtHubAt: new Date(),
                },
            });

            await tx.orderHistory.create({
                data: {
                    orderId: order.id,
                    eventType: 'AT_HUB',
                    description: 'Entrada de mercadoria registrada no hub',
                    location: hub.city + ', ' + hub.state,
                },
            });

            return { demand, order };
        });

        const fullOrder = await prisma.order.findUnique({
            where: { id: result.order.id },
            include: {
                demand: { include: { client: { select: { companyName: true } } } },
                currentHub: { select: { id: true, name: true, code: true } },
            },
        });

        res.status(201).json({
            success: true,
            data: fullOrder,
            message: 'Entrada registrada no hub',
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// GET /api/hubs/:id/cadastro-info - Info pública para página de cadastro (sem auth)
router.get('/:id/cadastro-info', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const hub = await prisma.hub.findUnique({
            where: { id },
            select: { id: true, name: true, code: true, active: true },
        });
        if (!hub || !hub.active) {
            throw new AppError('Hub não encontrado ou inativo', 404);
        }
        res.json({ success: true, data: { name: hub.name, code: hub.code } });
    } catch (error) {
        next(error);
    }
});

// POST /api/hubs/:id/register - Cadastro público via link (sem auth)
router.post('/:id/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const hubId = req.params.id as string;
        const body = addHubUserSchema.parse(req.body);

        const hub = await prisma.hub.findUnique({
            where: { id: hubId },
        });
        if (!hub || !hub.active) {
            throw new AppError('Hub não encontrado ou inativo', 404);
        }

        const doc = normalizeDocument(body.document);
        if (doc.length < 11) {
            throw new AppError('Documento inválido', 400);
        }

        const documentType = inferDocumentType(body.document);

        let person = await prisma.person.findUnique({
            where: { document: doc },
        });
        if (!person) {
            person = await prisma.person.create({
                data: {
                    documentType,
                    document: doc,
                    legalName: body.legalName,
                    country: 'BRASIL',
                },
            });
        }

        const existingUser = await prisma.user.findUnique({
            where: { email: body.email },
        });

        if (existingUser) {
            // Multi-conta: adicionar HUB ao usuário existente (verificar senha)
            const validPassword = await bcrypt.compare(body.password, existingUser.password);
            if (!validPassword) {
                throw new AppError('Senha incorreta para este email. Use a senha da sua conta existente.', 401);
            }
            const hasHub = (existingUser.roles ?? []).includes('HUB');
            if (hasHub && existingUser.hubId === hubId) {
                throw new AppError('Você já está cadastrado neste depósito.', 400);
            }
            if (hasHub && existingUser.hubId !== hubId) {
                throw new AppError('Você já opera outro depósito. Contate o admin para adicionar este.', 400);
            }
            const newRoles = [...(existingUser.roles ?? []), 'HUB'] as import('@prisma/client').UserRole[];
            const user = await prisma.user.update({
                where: { id: existingUser.id },
                data: {
                    roles: newRoles,
                    hubId,
                    personId: person.id,
                },
            });
            return res.status(201).json({
                success: true,
                data: {
                    id: user.id,
                    email: user.email,
                    hubId: user.hubId,
                    message: 'Perfil Hub atribuído. Faça login para acessar.',
                },
            });
        }

        const hashedPassword = await bcrypt.hash(body.password, 10);

        const user = await prisma.user.create({
            data: {
                email: body.email,
                password: hashedPassword,
                roles: ['HUB'],
                personId: person.id,
                hubId,
                permissions: body.permissions ?? [],
            },
        });

        res.status(201).json({
            success: true,
            data: {
                id: user.id,
                email: user.email,
                hubId: user.hubId,
                message: 'Conta criada. Faça login para acessar.',
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// POST /api/hubs/:id/users - Create HUB user (Admin only); document creates/finds Person
router.post('/:id/users', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const hubId = req.params.id as string;
        const body = addHubUserSchema.parse(req.body);

        const hub = await prisma.hub.findUnique({
            where: { id: hubId },
        });
        if (!hub || !hub.active) {
            throw new AppError('Hub não encontrado ou inativo', 404);
        }

        const doc = normalizeDocument(body.document);
        if (doc.length < 11) {
            throw new AppError('Documento inválido', 400);
        }

        const documentType = inferDocumentType(body.document);

        let person = await prisma.person.findUnique({
            where: { document: doc },
        });
        if (!person) {
            person = await prisma.person.create({
                data: {
                    documentType,
                    document: doc,
                    legalName: body.legalName,
                    country: 'BRASIL',
                },
            });
        }

        const existingUser = await prisma.user.findUnique({
            where: { email: body.email },
        });
        if (existingUser) {
            throw new AppError('Email já cadastrado', 400);
        }

        const hashedPassword = await bcrypt.hash(body.password, 10);

        const user = await prisma.user.create({
            data: {
                email: body.email,
                password: hashedPassword,
                roles: ['HUB'],
                personId: person.id,
                hubId,
                permissions: body.permissions ?? [],
            },
        });

        res.status(201).json({
            success: true,
            data: {
                id: user.id,
                email: user.email,
                hubId: user.hubId,
                personId: user.personId,
                permissions: user.permissions,
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// GET /api/hubs/:id
router.get('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        if (req.user!.roles.includes('HUB') && req.user!.hubId !== id) {
            throw new AppError('Not authorized to access this hub', 403);
        }

        const hub = await prisma.hub.findUnique({
            where: { id: id },
            include: {
                person: { select: { id: true, document: true, legalName: true } },
                _count: {
                    select: { manifests: true, ordersAtHub: true }
                }
            }
        });

        if (!hub) {
            throw new AppError('Hub not found', 404);
        }

        res.json({
            success: true,
            data: hub,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/hubs - Create hub (Admin only)
router.post('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = hubSchema.parse(req.body);

        // Check if code exists
        const existing = await prisma.hub.findUnique({
            where: { code: data.code }
        });

        if (existing) {
            throw new AppError('Hub code already exists', 400);
        }

        if (data.city && data.state) {
            const resolved = await resolveIbgeCode(data.city, data.state);
            if (resolved) {
                data.city = resolved.name;
                (data as any).cityIbgeCode = resolved.ibgeCode;
            } else {
                throw new AppError(`Cidade "${data.city} - ${data.state}" não encontrada no cadastro nacional.`, 400);
            }
        }

        const hub = await prisma.hub.create({
            data,
        });

        res.status(201).json({
            success: true,
            data: hub,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// PATCH /api/hubs/:id - Update hub (Admin only)
router.patch('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const data = hubSchema.partial().parse(req.body);

        const current = await prisma.hub.findUnique({ where: { id: id } });
        if (!current) throw new AppError('Hub not found', 404);

        if (data.city !== undefined || data.state !== undefined) {
            const nextCity = data.city !== undefined ? data.city : current.city;
            const nextState = data.state !== undefined ? data.state : current.state;
            if (nextCity && nextState) {
                const resolved = await resolveIbgeCode(nextCity, nextState);
                if (resolved) {
                    data.city = resolved.name;
                    (data as any).cityIbgeCode = resolved.ibgeCode;
                } else {
                    throw new AppError(`Cidade "${nextCity} - ${nextState}" não encontrada no cadastro nacional.`, 400);
                }
            }
        }

        const hub = await prisma.hub.update({
            where: { id: id },
            data,
        });

        res.json({
            success: true,
            data: hub,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// DELETE /api/hubs/:id - Soft delete (Admin only)
router.delete('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        await prisma.hub.update({
            where: { id: id },
            data: { active: false },
        });

        res.json({
            success: true,
            message: 'Hub deactivated',
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/hubs/search/coverage - Search hubs by city coverage
router.get('/search/coverage', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { city } = req.query;

        if (!city) {
            throw new AppError('City parameter is required', 400);
        }

        const hubs = await prisma.hub.findMany({
            where: {
                active: true,
                coverageCities: {
                    has: city as string,
                },
            },
        });

        res.json({
            success: true,
            data: hubs,
        });
    } catch (error) {
        next(error);
    }
});

export { router as hubsRouter };
