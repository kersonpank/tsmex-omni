import { Router, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { verifyLinkInvite } from '../services/linkInvite.js';

const router = Router();

// Validation schemas
const registerSchema = z.object({
    email: z.string().trim().toLowerCase().email('Invalid email'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    role: z.enum(['ADMIN', 'CLIENT', 'LINK']),
    // Client-specific fields
    companyName: z.string().optional(),
    document: z.string().optional(),
    contactName: z.string().optional(),
    phone: z.string().optional(),
    // Admin-specific fields
    name: z.string().optional(),
    // Link-specific: minimal "operacao" register (email + password + WhatsApp only)
    whatsappPhone: z.string().optional(),
    // Link full register (when not using minimal)
    vehicleTypeId: z.string().optional(),
    vehiclePlate: z.string().optional(),
    homeBase: z.string().optional(),
});

const loginSchema = z.object({
    email: z.string().trim().toLowerCase().email('Invalid email'),
    password: z.string().min(1, 'Password is required'),
});

function normalizeDocument(doc: string): string {
    return doc.replace(/\D/g, '');
}

function inferDocumentType(doc: string): 'CPF' | 'CNPJ' {
    const digits = normalizeDocument(doc);
    return digits.length === 11 ? 'CPF' : 'CNPJ';
}

// Generate JWT token
function generateToken(userId: string): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new AppError('JWT secret not configured', 500);

    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

    return jwt.sign(
        { userId },
        secret,
        { expiresIn } as jwt.SignOptions
    );
}

// POST /api/auth/register
const register = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = registerSchema.parse(req.body);
        const provision = req.user?.roles.includes('ADMIN') === true;
        // Cadastro público: só CLIENT e LINK (LINK nasce PENDING até aprovação do ADMIN).
        if (!provision && data.role === 'ADMIN') {
            throw new AppError('Este perfil deve ser cadastrado por um administrador.', 403);
        }
        if (data.role === 'CLIENT' && (!data.companyName || !data.document || !data.contactName || !data.phone)) {
            throw new AppError('Informe empresa, documento, contato e telefone.', 400);
        }

        const existingUser = await prisma.user.findUnique({
            where: { email: data.email },
            include: { link: true, client: true, admin: true },
        });

        // Se usuário existe: adicionar papel (multi-conta) somente provando a senha da conta.
        if (existingUser) {
            if (!provision) {
                const passwordOk = await bcrypt.compare(data.password, existingUser.password);
                if (!passwordOk) throw new AppError('Conta já cadastrada. Faça login ou informe a senha correta para adicionar o perfil.', 401);
            }
            const hasRole = (existingUser.roles ?? []).includes(data.role as any);
            if (hasRole) {
                throw new AppError(`Este email já possui o perfil ${data.role}. Faça login.`, 400);
            }
            const newRoles = [...(existingUser.roles ?? []), data.role as any];
            const user = await prisma.$transaction(async (tx) => {
                await tx.user.update({
                    where: { id: existingUser.id },
                    data: { roles: newRoles },
                });
                if (data.role === 'LINK' && !existingUser.link) {
                    const whatsappOrPhone = data.whatsappPhone || data.phone || '';
                    const pendingDoc = `PENDING-${existingUser.id}`;
                    let person = await tx.person.findUnique({ where: { document: pendingDoc } });
                    if (!person) {
                        person = await tx.person.create({
                            data: { documentType: 'CPF', document: pendingDoc, legalName: 'A completar', country: 'BRASIL' },
                        });
                    }
                    await tx.link.create({
                        data: {
                            userId: existingUser.id,
                            personId: person.id,
                            name: 'A completar',
                            document: pendingDoc,
                            phone: whatsappOrPhone,
                            vehicleTypeId: null,
                            vehiclePlate: 'A completar',
                            homeBase: 'A completar',
                            coverageStates: [],
                        },
                    });
                }
                return { ...existingUser, roles: newRoles };
            });
            if (provision) {
                return res.status(201).json({ success: true, data: { id: user.id, email: user.email, roles: user.roles } });
            }
            const token = generateToken(user.id);
            const payload: { user: { id: string; email: string; roles: string[] }; token: string; linkId?: string } = {
                user: { id: user.id, email: user.email, roles: user.roles },
                token,
            };
            const link = await prisma.link.findFirst({ where: { userId: user.id }, select: { id: true } });
            if (link) payload.linkId = link.id;
            return res.status(201).json({ success: true, data: payload });
        }

        const hashedPassword = await bcrypt.hash(data.password, 10);

        const user = await prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
                data: {
                    email: data.email,
                    password: hashedPassword,
                    roles: [data.role as any],
                }
            });

            // Create role-specific profile
            if (data.role === 'CLIENT' && data.companyName && data.document && data.contactName && data.phone) {
                const docNorm = normalizeDocument(data.document);

                // Find or create Person (CNPJ) for auto-agregação
                let person = await tx.person.findUnique({
                    where: { document: docNorm },
                });
                if (!person) {
                    person = await tx.person.create({
                        data: {
                            documentType: 'CNPJ',
                            document: docNorm,
                            legalName: data.companyName,
                            country: 'BRASIL',
                        },
                    });
                }

                // Check if AccountCompany with this CNPJ exists (match by normalized)
                const allCompanies = await tx.accountCompany.findMany();
                const existingCompany = allCompanies.find(c => normalizeDocument(c.cnpj) === docNorm);

                let accountId: string | null = null;
                let accountCompanyId: string | null = null;

                if (existingCompany && !provision) {
                    throw new AppError('Empresa já cadastrada. Solicite acesso ao administrador.', 409);
                }
                if (existingCompany) {
                    accountId = existingCompany.accountId;
                    accountCompanyId = existingCompany.id;
                } else {
                    const account = await tx.account.create({
                        data: {
                            name: data.companyName,
                            accountType: 'COMPANY',
                            companies: {
                                create: {
                                    cnpj: docNorm,
                                    legalName: data.companyName,
                                    isPrimary: true,
                                }
                            },
                            contacts: {
                                create: {
                                    name: data.contactName,
                                    phone: data.phone,
                                    isPrimary: true,
                                }
                            }
                        },
                        include: {
                            companies: {
                                where: { isPrimary: true },
                                take: 1,
                            }
                        }
                    });
                    accountId = account.id;
                    accountCompanyId = account.companies[0].id;
                }

                await tx.client.create({
                    data: {
                        userId: newUser.id,
                        personId: person.id,
                        accountId,
                        accountCompanyId,
                        companyName: data.companyName,
                        document: docNorm,
                        contactName: data.contactName,
                        phone: data.phone,
                    }
                });
                
                // Update user with accountId
                await tx.user.update({
                    where: { id: newUser.id },
                    data: { accountId }
                });
            } else if (data.role === 'ADMIN' && data.name) {
                await tx.admin.create({
                    data: {
                        userId: newUser.id,
                        name: data.name,
                    }
                });
            } else if (data.role === 'LINK') {
                const whatsappOrPhone = data.whatsappPhone || data.phone;
                if (!whatsappOrPhone) {
                    throw new AppError('LINK requires whatsappPhone or phone', 400);
                }
                // Minimal "operacao" register: only email + password + WhatsApp → placeholders
                if (!data.name || !data.document || !data.vehiclePlate || !data.homeBase) {
                    const pendingDoc = `PENDING-${newUser.id}`;
                    let person = await tx.person.findUnique({
                        where: { document: pendingDoc },
                    });
                    if (!person) {
                        person = await tx.person.create({
                            data: {
                                documentType: 'CPF',
                                document: pendingDoc,
                                legalName: 'A completar',
                                country: 'BRASIL',
                            },
                        });
                    }
                    await tx.link.create({
                        data: {
                            userId: newUser.id,
                            personId: person.id,
                            name: 'A completar',
                            document: pendingDoc,
                            phone: whatsappOrPhone,
                            vehicleTypeId: null,
                            vehiclePlate: 'A completar',
                            homeBase: 'A completar',
                            coverageStates: [],
                        }
                    });
                } else {
                    // Full register (legacy)
                    const docNorm = normalizeDocument(data.document);
                    let person = await tx.person.findUnique({
                        where: { document: docNorm },
                    });
                    if (!person) {
                        person = await tx.person.create({
                            data: {
                                documentType: inferDocumentType(data.document),
                                document: docNorm,
                                legalName: data.name,
                                country: 'BRASIL',
                            },
                        });
                    }
                    await tx.link.create({
                        data: {
                            userId: newUser.id,
                            personId: person.id,
                            name: data.name,
                            document: docNorm,
                            phone: data.phone!,
                            vehicleTypeId: data.vehicleTypeId || null,
                            vehiclePlate: data.vehiclePlate!,
                            homeBase: data.homeBase!,
                            coverageStates: [],
                        }
                    });
                }
            }

            return newUser;
        });

        if (provision) {
            return res.status(201).json({ success: true, data: { id: user.id, email: user.email, roles: user.roles } });
        }
        const token = generateToken(user.id);
        const payload: { user: { id: string; email: string; roles: string[] }; token: string; linkId?: string } = {
            user: { id: user.id, email: user.email, roles: user.roles },
            token,
        };
        if (user.roles.includes('LINK')) {
            const link = await prisma.link.findFirst({ where: { userId: user.id }, select: { id: true } });
            if (link) payload.linkId = link.id;
        }

        res.status(201).json({
            success: true,
            data: payload,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
};

router.post('/register', register);
router.post('/provision', authenticate, authorize('ADMIN'), register);

router.post('/claim-link', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = z.object({ token: z.string().min(1), email: z.string().trim().toLowerCase().email(), password: z.string().min(6) }).parse(req.body);
        const linkId = verifyLinkInvite(data.token);
        const existing = await prisma.user.findUnique({ where: { email: data.email }, include: { link: true } });
        if (existing && (!await bcrypt.compare(data.password, existing.password) || existing.link)) {
            throw new AppError('Esta conta já existe. Confirme a senha correta ou use outro email sem perfil Link.', 409);
        }
        const hashedPassword = existing ? undefined : await bcrypt.hash(data.password, 10);
        const user = await prisma.$transaction(async (tx) => {
            const link = await tx.link.findUnique({ where: { id: linkId }, select: { userId: true } });
            if (!link || link.userId) throw new AppError('Convite já utilizado ou transportador não encontrado.', 409);
            const claimedUser = existing
                ? await tx.user.update({ where: { id: existing.id }, data: { roles: { set: [...new Set([...existing.roles, 'LINK' as const])] } } })
                : await tx.user.create({ data: { email: data.email, password: hashedPassword!, roles: ['LINK'] } });
            const claimed = await tx.link.updateMany({ where: { id: linkId, userId: null }, data: { userId: claimedUser.id } });
            if (claimed.count !== 1) throw new AppError('Convite já utilizado.', 409);
            return claimedUser;
        });
        res.status(201).json({ success: true, data: { user: { id: user.id, email: user.email, roles: user.roles }, token: generateToken(user.id), linkId } });
    } catch (error) { next(error); }
});

// POST /api/auth/login
router.post('/login', async (req, res: Response, next: NextFunction) => {
    try {
        const data = loginSchema.parse(req.body);

        const user = await prisma.user.findUnique({
            where: { email: data.email },
            include: {
                hub: { select: { id: true, name: true, code: true } },
                client: {
                    include: {
                        account: {
                            include: {
                                companies: {
                                    where: { isPrimary: true },
                                    take: 1,
                                },
                                contacts: {
                                    where: { isPrimary: true },
                                    take: 1,
                                },
                            }
                        }
                    }
                },
                admin: true,
                link: true,
                account: {
                    include: {
                        companies: {
                            where: { isPrimary: true },
                            take: 1,
                        },
                        contacts: {
                            where: { isPrimary: true },
                            take: 1,
                        },
                    }
                },
            }
        });

        if (!user) {
            throw new AppError('Invalid credentials', 401);
        }

        if (!user.active) {
            throw new AppError('Account is inactive', 401);
        }

        const validPassword = await bcrypt.compare(data.password, user.password);
        if (!validPassword) {
            throw new AppError('Invalid credentials', 401);
        }

        const token = generateToken(user.id);

        // Build profile for each role (multi-conta)
        const profile: Record<string, any> = {};
        if (user.client) {
            profile.client = {
                companyName: user.client.companyName,
                document: user.client.document,
                contactName: user.client.contactName,
            };
        }
        if (user.admin) profile.admin = { name: user.admin.name };
        if (user.link) {
            profile.link = {
                linkId: user.link.id,
                name: user.link.name,
                approvalStatus: user.link.approvalStatus,
                score: user.link.score,
            };
        }
        if (user.hub) {
            profile.hub = {
                hubId: user.hubId,
                hub: user.hub,
                permissions: user.permissions ?? [],
            };
        }

        const accountData = user.account ? {
            id: user.account.id,
            name: user.account.name,
            accountType: user.account.accountType,
            companies: user.account.companies,
            contacts: user.account.contacts,
        } : null;

        const userPayload: { id: string; email: string; roles: string[]; profile: any; hubId?: string; permissions?: string[] } = {
            id: user.id,
            email: user.email,
            roles: user.roles ?? [],
            profile,
        };
        if (user.hubId) userPayload.hubId = user.hubId;
        if (user.permissions && user.permissions.length > 0) userPayload.permissions = user.permissions;

        res.json({
            success: true,
            data: {
                user: userPayload,
                account: accountData,
                token,
            }
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            include: {
                hub: { select: { id: true, name: true, code: true } },
                client: true,
                admin: true,
                link: {
                    include: {
                        vehicleType: true,
                        onboarding: {
                            select: { id: true, onboardingComplete: true }
                        }
                    }
                },
                hubOnboarding: {
                    select: { id: true, onboardingComplete: true }
                },
            }
        });

        if (!user) {
            throw new AppError('User not found', 404);
        }

        res.json({
            success: true,
            data: {
                id: user.id,
                email: user.email,
                roles: user.roles ?? [],
                hubId: user.hubId,
                hub: user.hub,
                permissions: user.permissions ?? [],
                client: user.client,
                admin: user.admin,
                link: user.link,
                hubOnboarding: user.hubOnboarding,
            }
        });
    } catch (error) {
        next(error);
    }
});

export { router as authRouter };
