import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { getParamId } from '../lib/routeUtils.js';
import { consultCNPJ } from '../services/cnpjService.js';

// Generate JWT token helper
function generateToken(userId: string): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new AppError('JWT secret not configured', 500);
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    return jwt.sign({ userId }, secret, { expiresIn } as jwt.SignOptions);
}

const router = Router();

function normalizeDocument(doc: string): string {
    return doc.replace(/\D/g, '');
}

// ==================== VALIDATION SCHEMAS ====================

const onboardingSchema = z.object({
    // Account data
    accountName: z.string().min(1, 'Account name is required'),
    accountType: z.enum(['COMPANY', 'INDIVIDUAL']).default('COMPANY'),
    
    // Primary company (CNPJ)
    primaryCompany: z.object({
        cnpj: z.string().min(1, 'CNPJ is required').transform(val => val.trim()),
        legalName: z.string().min(1, 'Legal name is required').transform(val => val.trim()).refine(val => val.length > 0, 'Legal name cannot be empty'),
        tradeName: z.string().optional().transform(val => val?.trim() || undefined),
        address: z.string().optional().transform(val => val?.trim() || undefined),
        city: z.string().optional().transform(val => val?.trim() || undefined),
        state: z.string().optional().transform(val => val?.trim()?.toUpperCase() || undefined),
    }),
    
    // Contacts
    contacts: z.array(z.object({
        name: z.string().min(1, 'Contact name is required'),
        role: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        whatsapp: z.string().optional(),
        isPrimary: z.boolean().default(false),
    })).min(1, 'At least one contact is required'),
    
    // Admin user
    adminUser: z.object({
        email: z.string().email('Invalid email'),
        password: z.string().min(6, 'Password must be at least 6 characters'),
        name: z.string().min(1, 'User name is required'),
    }),
    
    // Additional companies (optional)
    additionalCompanies: z.array(z.object({
        cnpj: z.string().min(1, 'CNPJ is required').transform(val => val.trim()),
        legalName: z.string().min(1, 'Legal name is required').transform(val => val.trim()).refine(val => val.length > 0, 'Legal name cannot be empty'),
        tradeName: z.string().optional().transform(val => val?.trim() || undefined),
        address: z.string().optional().transform(val => val?.trim() || undefined),
        city: z.string().optional().transform(val => val?.trim() || undefined),
        state: z.string().optional().transform(val => val?.trim()?.toUpperCase() || undefined),
    })).optional(),
});

const addCompanySchema = z.object({
    cnpj: z.string().min(1, 'CNPJ is required'),
    legalName: z.string().min(1, 'Legal name is required'),
    tradeName: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    isPrimary: z.boolean().default(false),
});

const addUserSchema = z.object({
    email: z.string().email('Invalid email'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    name: z.string().min(1, 'User name is required'),
    cpf: z.string().optional().transform(v => v ? normalizeDocument(v) : undefined),
    accountCompanyId: z.string().uuid().optional(),
});

const addContactSchema = z.object({
    name: z.string().min(1, 'Contact name is required'),
    role: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    whatsapp: z.string().optional(),
    isPrimary: z.boolean().default(false),
});

// ==================== HELPER: Get Account from User ====================

async function getAccountFromUser(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { account: true }
    });
    
    if (!user || !user.accountId) {
        throw new AppError('User does not belong to an account', 404);
    }
    
    return user.accountId;
}

// ==================== CHECK ENDPOINTS (Public - for onboarding) ====================

// GET /api/accounts/check-cnpj?cnpj= - Check if CNPJ is already registered
router.get('/check-cnpj', async (req, res: Response, next: NextFunction) => {
    try {
        const cnpj = req.query.cnpj as string;
        if (!cnpj || typeof cnpj !== 'string') {
            return res.status(400).json({ exists: false, error: 'CNPJ required' });
        }
        const cnpjNorm = normalizeDocument(cnpj);
        if (cnpjNorm.length !== 14) {
            return res.json({ exists: false });
        }
        const existing = await prisma.accountCompany.findFirst({
            where: { cnpj: cnpjNorm },
            include: { account: { select: { name: true } } },
        });
        if (!existing) {
            return res.json({ exists: false });
        }
        return res.json({ exists: true, accountName: existing.account?.name });
    } catch (err) {
        next(err);
    }
});

// GET /api/accounts/check-email?email= - Check if email is already registered
router.get('/check-email', async (req, res: Response, next: NextFunction) => {
    try {
        const email = (req.query.email as string)?.trim?.();
        if (!email || typeof email !== 'string') {
            return res.status(400).json({ exists: false, error: 'Email required' });
        }
        const existing = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
        });
        return res.json({ exists: !!existing });
    } catch (err) {
        next(err);
    }
});

// ==================== ONBOARDING ====================

// POST /api/accounts/onboarding - Create complete account
router.post('/onboarding', async (req, res: Response, next: NextFunction) => {
    try {
        const data = onboardingSchema.parse(req.body);
        
        // Validate CNPJ uniqueness (compare normalized)
        const allCnpjsNorm = [
            normalizeDocument(data.primaryCompany.cnpj),
            ...(data.additionalCompanies || []).map(c => normalizeDocument(c.cnpj))
        ];
        const existingCompanies = await prisma.accountCompany.findMany();
        const alreadyRegistered = existingCompanies.filter(c =>
            allCnpjsNorm.includes(normalizeDocument(c.cnpj))
        );
        if (alreadyRegistered.length > 0) {
            throw new AppError(
                `CNPJ(s) already registered: ${alreadyRegistered.map(c => c.cnpj).join(', ')}`,
                400
            );
        }
        
        // Validate email uniqueness
        const existingUser = await prisma.user.findUnique({
            where: { email: data.adminUser.email }
        });
        
        if (existingUser) {
            throw new AppError('Email already registered', 400);
        }
        
        const primaryCnpjNorm = normalizeDocument(data.primaryCompany.cnpj);

        // Create everything in transaction
        const result = await prisma.$transaction(async (tx) => {
            // 1. Create Account
            const account = await tx.account.create({
                data: {
                    name: data.accountName,
                    accountType: data.accountType,
                }
            });
            
            // 2. Create primary company (CNPJ normalizado)
            const primaryCompany = await tx.accountCompany.create({
                data: {
                    accountId: account.id,
                    cnpj: primaryCnpjNorm,
                    legalName: data.primaryCompany.legalName,
                    tradeName: data.primaryCompany.tradeName,
                    address: data.primaryCompany.address,
                    city: data.primaryCompany.city,
                    state: data.primaryCompany.state,
                    isPrimary: true,
                }
            });
            
            // 3. Create additional companies
            const additionalCompanies = [];
            if (data.additionalCompanies && data.additionalCompanies.length > 0) {
                for (const company of data.additionalCompanies) {
                    const created = await tx.accountCompany.create({
                        data: {
                            accountId: account.id,
                            cnpj: normalizeDocument(company.cnpj),
                            legalName: company.legalName,
                            tradeName: company.tradeName,
                            address: company.address,
                            city: company.city,
                            state: company.state,
                            isPrimary: false,
                        }
                    });
                    additionalCompanies.push(created);
                }
            }
            
            // 4. Create contacts
            const contacts = [];
            for (const contact of data.contacts) {
                const created = await tx.accountContact.create({
                    data: {
                        accountId: account.id,
                        name: contact.name,
                        role: contact.role,
                        email: contact.email,
                        phone: contact.phone,
                        whatsapp: contact.whatsapp,
                        isPrimary: contact.isPrimary,
                    }
                });
                contacts.push(created);
            }
            
            // 5. Create admin user
            const hashedPassword = await bcrypt.hash(data.adminUser.password, 10);
            const user = await tx.user.create({
                data: {
                    email: data.adminUser.email,
                    password: hashedPassword,
                    roles: ['CLIENT'],
                    accountId: account.id,
                }
            });
            
            // 6. Find or create Person (CNPJ) and create Client for primary company
            let person = await tx.person.findUnique({
                where: { document: primaryCnpjNorm },
            });
            if (!person) {
                person = await tx.person.create({
                    data: {
                        documentType: 'CNPJ',
                        document: primaryCnpjNorm,
                        legalName: data.primaryCompany.legalName,
                        tradeName: data.primaryCompany.tradeName,
                        address: data.primaryCompany.address,
                        city: data.primaryCompany.city,
                        state: data.primaryCompany.state,
                        country: 'BRASIL',
                    },
                });
            }

            const primaryContact = contacts.find(c => c.isPrimary) || contacts[0];
            const client = await tx.client.create({
                data: {
                    userId: user.id,
                    personId: person.id,
                    accountId: account.id,
                    accountCompanyId: primaryCompany.id,
                    companyName: data.primaryCompany.legalName,
                    tradeName: data.primaryCompany.tradeName,
                    document: primaryCnpjNorm,
                    contactName: primaryContact.name,
                    phone: primaryContact.phone || '',
                }
            });
            
            return {
                account,
                primaryCompany,
                additionalCompanies,
                contacts,
                user,
                client,
            };
        });
        
        // Generate token for immediate login
        const token = generateToken(result.user.id);
        
        res.status(201).json({
            success: true,
            data: {
                account: {
                    ...result.account,
                    companies: [result.primaryCompany, ...result.additionalCompanies],
                    contacts: result.contacts,
                },
                user: {
                    id: result.user.id,
                    email: result.user.email,
                    roles: result.user.roles,
                },
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

// ==================== ACCOUNT INFO ====================

// GET /api/accounts/me - Get current user's account
router.get('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accountId = await getAccountFromUser(req.user!.id);
        
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            include: {
                companies: {
                    orderBy: { isPrimary: 'desc' }
                },
                contacts: {
                    orderBy: { isPrimary: 'desc' }
                },
                users: {
                    include: {
                        client: {
                            select: {
                                id: true,
                                document: true,
                                companyName: true,
                            }
                        }
                    }
                },
                _count: {
                    select: {
                        opportunities: true,
                    }
                }
            }
        });
        
        if (!account) {
            throw new AppError('Account not found', 404);
        }
        
        res.json({
            success: true,
            data: account,
        });
    } catch (error) {
        next(error);
    }
});

// ==================== COMPANIES (CNPJs) ====================

// GET /api/accounts/me/companies - List companies
router.get('/me/companies', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accountId = await getAccountFromUser(req.user!.id);
        
        const companies = await prisma.accountCompany.findMany({
            where: { accountId },
            include: {
                _count: {
                    select: { clients: true }
                }
            },
            orderBy: { isPrimary: 'desc' }
        });
        
        res.json({
            success: true,
            data: companies,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/accounts/me/companies - Add company
router.post('/me/companies', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accountId = await getAccountFromUser(req.user!.id);
        const data = addCompanySchema.parse(req.body);
        
        // Check if CNPJ already exists
        const existing = await prisma.accountCompany.findUnique({
            where: { cnpj: data.cnpj }
        });
        
        if (existing) {
            throw new AppError('CNPJ already registered', 400);
        }
        
        // If marking as primary, unset other primaries
        if (data.isPrimary) {
            await prisma.accountCompany.updateMany({
                where: { accountId, isPrimary: true },
                data: { isPrimary: false }
            });
        }
        
        const company = await prisma.accountCompany.create({
            data: {
                accountId,
                ...data,
            }
        });
        
        res.status(201).json({
            success: true,
            data: company,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// PATCH /api/accounts/me/companies/:id - Update company
router.patch('/me/companies/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accountId = await getAccountFromUser(req.user!.id);
        const id = getParamId(req.params);
        const data = addCompanySchema.partial().parse(req.body);
        
        // Verify company belongs to account
        const company = await prisma.accountCompany.findFirst({
            where: { id, accountId }
        });
        
        if (!company) {
            throw new AppError('Company not found', 404);
        }
        
        // If marking as primary, unset other primaries
        if (data.isPrimary) {
            await prisma.accountCompany.updateMany({
                where: { accountId, isPrimary: true, id: { not: id } },
                data: { isPrimary: false }
            });
        }
        
        const updated = await prisma.accountCompany.update({
            where: { id },
            data,
        });
        
        res.json({
            success: true,
            data: updated,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// DELETE /api/accounts/me/companies/:id - Soft delete company
router.delete('/me/companies/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accountId = await getAccountFromUser(req.user!.id);
        const id = getParamId(req.params);
        
        // Verify company belongs to account
        const company = await prisma.accountCompany.findFirst({
            where: { id, accountId }
        });
        
        if (!company) {
            throw new AppError('Company not found', 404);
        }
        
        // Check if it's the primary company
        if (company.isPrimary) {
            throw new AppError('Cannot delete primary company', 400);
        }
        
        // Check if there are clients using this company
        const clientsCount = await prisma.client.count({
            where: { accountCompanyId: id }
        });
        
        if (clientsCount > 0) {
            throw new AppError('Cannot delete company with associated clients', 400);
        }
        
        await prisma.accountCompany.delete({
            where: { id }
        });
        
        res.json({
            success: true,
            message: 'Company deleted',
        });
    } catch (error) {
        next(error);
    }
});

// ==================== USERS ====================

// GET /api/accounts/me/users - List users
router.get('/me/users', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accountId = await getAccountFromUser(req.user!.id);
        
        const users = await prisma.user.findMany({
            where: { accountId },
            include: {
                client: {
                    include: {
                        accountCompany: {
                            select: {
                                id: true,
                                cnpj: true,
                                legalName: true,
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        
        res.json({
            success: true,
            data: users.map(u => ({
                id: u.id,
                email: u.email,
                roles: u.roles,
                active: u.active,
                createdAt: u.createdAt,
                client: u.client ? {
                    id: u.client.id,
                    companyName: u.client.companyName,
                    document: u.client.document,
                    accountCompany: u.client.accountCompany,
                } : null,
            })),
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/accounts/me/users - Add user
router.post('/me/users', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accountId = await getAccountFromUser(req.user!.id);
        const data = addUserSchema.parse(req.body);
        
        // Check if email exists
        const existingUser = await prisma.user.findUnique({
            where: { email: data.email }
        });
        
        if (existingUser) {
            throw new AppError('Email already registered', 400);
        }
        
        // Verify accountCompany belongs to account if provided
        if (data.accountCompanyId) {
            const company = await prisma.accountCompany.findFirst({
                where: { id: data.accountCompanyId, accountId }
            });
            
            if (!company) {
                throw new AppError('Company not found in your account', 404);
            }
        }
        
        const hashedPassword = await bcrypt.hash(data.password, 10);
        
        const result = await prisma.$transaction(async (tx) => {
            // Find or create Person (CPF) for the contact when CPF provided
            let personId: string | null = null;
            if (data.cpf && data.cpf.length === 11) {
                let person = await tx.person.findUnique({
                    where: { document: data.cpf },
                });
                if (!person) {
                    person = await tx.person.create({
                        data: {
                            documentType: 'CPF',
                            document: data.cpf,
                            legalName: data.name,
                            country: 'BRASIL',
                        },
                    });
                }
                personId = person.id;
            }

            const user = await tx.user.create({
                data: {
                    email: data.email,
                    password: hashedPassword,
                    roles: ['CLIENT'],
                    accountId,
                    personId,
                }
            });

            let client = null;
            if (data.accountCompanyId) {
                const company = await tx.accountCompany.findUnique({
                    where: { id: data.accountCompanyId }
                });

                if (company) {
                    const companyDocNorm = normalizeDocument(company.cnpj);
                    let companyPerson = await tx.person.findUnique({
                        where: { document: companyDocNorm },
                    });
                    if (!companyPerson) {
                        companyPerson = await tx.person.create({
                            data: {
                                documentType: 'CNPJ',
                                document: companyDocNorm,
                                legalName: company.legalName,
                                tradeName: company.tradeName ?? undefined,
                                address: company.address ?? undefined,
                                city: company.city ?? undefined,
                                state: company.state ?? undefined,
                                country: 'BRASIL',
                            },
                        });
                    }
                    client = await tx.client.create({
                        data: {
                            userId: user.id,
                            personId: companyPerson.id,
                            accountId,
                            accountCompanyId: company.id,
                            companyName: company.legalName,
                            tradeName: company.tradeName,
                            document: company.cnpj,
                            contactName: data.name,
                            phone: '',
                        }
                    });
                }
            }

            return { user, client };
        });
        
        res.status(201).json({
            success: true,
            data: {
                id: result.user.id,
                email: result.user.email,
                roles: result.user.roles,
                client: result.client,
            }
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// PATCH /api/accounts/me/users/:id - Update user
router.patch('/me/users/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accountId = await getAccountFromUser(req.user!.id);
        const id = getParamId(req.params);
        const data = z.object({
            active: z.boolean().optional(),
            accountCompanyId: z.string().uuid().optional(),
        }).parse(req.body);
        
        // Verify user belongs to account
        const user = await prisma.user.findFirst({
            where: { id, accountId }
        });
        
        if (!user) {
            throw new AppError('User not found', 404);
        }
        
        // Cannot deactivate yourself
        if (data.active === false && id === req.user!.id) {
            throw new AppError('Cannot deactivate yourself', 400);
        }
        
        const updateData: any = {};
        if (data.active !== undefined) {
            updateData.active = data.active;
        }
        
        await prisma.user.update({
            where: { id },
            data: updateData,
        });
        
        res.json({
            success: true,
            message: 'User updated',
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// DELETE /api/accounts/me/users/:id - Deactivate user
router.delete('/me/users/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accountId = await getAccountFromUser(req.user!.id);
        const id = getParamId(req.params);
        
        // Cannot delete yourself
        if (id === req.user!.id) {
            throw new AppError('Cannot delete yourself', 400);
        }
        
        // Verify user belongs to account
        const user = await prisma.user.findFirst({
            where: { id, accountId }
        });
        
        if (!user) {
            throw new AppError('User not found', 404);
        }
        
        // Soft delete (deactivate)
        await prisma.user.update({
            where: { id },
            data: { active: false }
        });
        
        res.json({
            success: true,
            message: 'User deactivated',
        });
    } catch (error) {
        next(error);
    }
});

// ==================== CONTACTS ====================

// GET /api/accounts/me/contacts - List contacts
router.get('/me/contacts', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accountId = await getAccountFromUser(req.user!.id);
        
        const contacts = await prisma.accountContact.findMany({
            where: { accountId },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }]
        });
        
        res.json({
            success: true,
            data: contacts,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/accounts/me/contacts - Add contact
router.post('/me/contacts', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accountId = await getAccountFromUser(req.user!.id);
        const data = addContactSchema.parse(req.body);
        
        // If marking as primary, unset other primaries
        if (data.isPrimary) {
            await prisma.accountContact.updateMany({
                where: { accountId, isPrimary: true },
                data: { isPrimary: false }
            });
        }
        
        const contact = await prisma.accountContact.create({
            data: {
                accountId,
                ...data,
            }
        });
        
        res.status(201).json({
            success: true,
            data: contact,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// PATCH /api/accounts/me/contacts/:id - Update contact
router.patch('/me/contacts/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accountId = await getAccountFromUser(req.user!.id);
        const id = getParamId(req.params);
        const data = addContactSchema.partial().parse(req.body);
        
        // Verify contact belongs to account
        const contact = await prisma.accountContact.findFirst({
            where: { id, accountId }
        });
        
        if (!contact) {
            throw new AppError('Contact not found', 404);
        }
        
        // If marking as primary, unset other primaries
        if (data.isPrimary) {
            await prisma.accountContact.updateMany({
                where: { accountId, isPrimary: true, id: { not: id } },
                data: { isPrimary: false }
            });
        }
        
        const updated = await prisma.accountContact.update({
            where: { id },
            data,
        });
        
        res.json({
            success: true,
            data: updated,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// DELETE /api/accounts/me/contacts/:id - Delete contact
router.delete('/me/contacts/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accountId = await getAccountFromUser(req.user!.id);
        const id = getParamId(req.params);
        
        // Verify contact belongs to account
        const contact = await prisma.accountContact.findFirst({
            where: { id, accountId }
        });
        
        if (!contact) {
            throw new AppError('Contact not found', 404);
        }
        
        await prisma.accountContact.delete({
            where: { id }
        });
        
        res.json({
            success: true,
            message: 'Contact deleted',
        });
    } catch (error) {
        next(error);
    }
});

// ==================== STATS ====================

// GET /api/accounts/me/stats - Get account statistics
router.get('/me/stats', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const accountId = await getAccountFromUser(req.user!.id);
        
        // Get all clients in this account
        const clients = await prisma.client.findMany({
            where: { accountId },
            select: { id: true }
        });
        
        const clientIds = clients.map(c => c.id);
        
        // Get demands stats
        const demands = await prisma.demand.findMany({
            where: { clientId: { in: clientIds } },
            select: {
                status: true,
                quotedPrice: true,
                createdAt: true,
            }
        });
        
        const stats = {
            totalDemands: demands.length,
            pending: demands.filter(d => d.status === 'PENDING').length,
            quoted: demands.filter(d => d.status === 'QUOTED').length,
            inTransit: demands.filter(d => d.status === 'IN_TRANSIT').length,
            delivered: demands.filter(d => d.status === 'DELIVERED').length,
            totalValue: demands
                .filter(d => d.quotedPrice)
                .reduce((sum, d) => sum + (d.quotedPrice || 0), 0),
            companiesCount: await prisma.accountCompany.count({
                where: { accountId }
            }),
            usersCount: await prisma.user.count({
                where: { accountId, active: true }
            }),
            contactsCount: await prisma.accountContact.count({
                where: { accountId }
            }),
        };
        
        res.json({
            success: true,
            data: stats,
        });
    } catch (error) {
        next(error);
    }
});

// ==================== CNPJ CONSULTATION ====================

// GET /api/accounts/cnpj/:cnpj - Consult CNPJ and return data for auto-fill
router.get('/cnpj/:cnpj', async (req, res: Response, next: NextFunction) => {
    try {
        const cnpj = req.params.cnpj.replace(/\D/g, '');

        if (cnpj.length !== 14) {
            throw new AppError('CNPJ must have 14 digits', 400);
        }

        // Get Sintegra token from environment (optional)
        const sintegraToken = process.env.SINTEGRA_TOKEN;

        // Consult CNPJ
        const cnpjData = await consultCNPJ(cnpj, sintegraToken);

        // Check if CNPJ already exists in database
        const existingCompany = await prisma.accountCompany.findUnique({
            where: { cnpj },
        });

        res.json({
            success: true,
            data: {
                ...cnpjData,
                alreadyExists: !!existingCompany,
            }
        });
    } catch (error) {
        next(error);
    }
});

export { router as accountsRouter };
