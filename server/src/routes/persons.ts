import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { isValidCpf, isValidCnpj } from '../services/documentValidation.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { getParamId } from '../lib/routeUtils.js';
import { findOrCreateConcluirCadastroColumn } from './pipeline.js';
import { validateSelectedCity, validateSelectedAddress } from '../services/selectedCity.js';
import { ensurePublicCnpjPerson } from '../services/intake/publicCnpjParty.js';
import { lookupCnpjSuggestion } from '../services/documentLookup.js';

const router = Router();

/** Remove pontuação e normaliza espaços para busca (ex: "w. da s" encontra "W. DA S. MESQUITA") */
function normalizeForSearch(s: string): string {
    return s
        .replace(/[.\-,']/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/** Papéis (relações) que a pessoa já tem — a busca olha a pessoa, não só um papel. */
export function personRoles(person: { clients?: unknown[]; links?: unknown[]; drivers?: unknown[]; hubs?: unknown[] }): string[] {
    const roles: string[] = [];
    if (person.drivers?.length) roles.push('motorista');
    if (person.links?.length) roles.push('transportador');
    if (person.clients?.length) roles.push('cliente');
    if (person.hubs?.length) roles.push('hub');
    return roles;
}

const asDriverSchema = z.object({ linkId: z.string().min(1).optional() });

const addClientSchema = z.object({
    email: z.string().email('Email inválido'),
    password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
    contactName: z.string().min(1, 'Nome do contato é obrigatório'),
    phone: z.string().min(1, 'Telefone é obrigatório'),
});

const addLinkSchema = z.object({
    email: z.string().email('Email inválido'),
    password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
    name: z.string().min(1, 'Nome é obrigatório'),
    phone: z.string().min(1, 'Telefone é obrigatório'),
    vehicleTypeId: z.string().uuid(),
    vehiclePlate: z.string().min(1, 'Placa é obrigatória'),
    homeBase: z.string().min(1, 'Base é obrigatória'),
});

const addHubUserSchema = z.object({
    hubId: z.string().uuid('Hub é obrigatório'),
    email: z.string().email('Email inválido'),
    password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
    permissions: z.array(z.string()).optional().default([]),
});

function normalizeDocument(doc: string): string {
    return doc.replace(/\D/g, '');
}

function inferDocumentType(doc: string): 'CPF' | 'CNPJ' {
    const digits = normalizeDocument(doc);
    return digits.length === 11 ? 'CPF' : 'CNPJ';
}

function validateDocument(documentType: 'CPF' | 'CNPJ', document: string): void {
    const digits = normalizeDocument(document);
    if (documentType === 'CPF' && digits.length !== 11) {
        throw new AppError('CPF deve ter 11 dígitos', 400);
    }
    if (documentType === 'CNPJ' && digits.length !== 14) {
        throw new AppError('CNPJ deve ter 14 dígitos', 400);
    }
    if (documentType === 'CPF' && !isValidCpf(digits)) throw new AppError('CPF inválido.', 400);
    if (documentType === 'CNPJ' && !isValidCnpj(digits)) throw new AppError('CNPJ inválido.', 400);
}

const stateRegistrationSchema = z.string().optional().transform(v => {
    const trimmed = v?.trim();
    if (!trimmed) return undefined;
    const upper = trimmed.toUpperCase();
    if (upper === 'ISENTO') return 'ISENTO';
    return trimmed.replace(/\D/g, '') || undefined;
}).refine(val => {
    if (val === undefined || val === 'ISENTO') return true;
    return val.length >= 2 && val.length <= 14;
}, {
    message: "Inscrição Estadual deve ter entre 2 e 14 dígitos numéricos ou ser 'ISENTO'"
});

const createPersonSchema = z.object({
    documentType: z.enum(['CPF', 'CNPJ']),
    document: z.string().min(1, 'Documento é obrigatório').transform(normalizeDocument),
    legalName: z.string().min(1, 'Nome/razão social é obrigatório').trim(),
    tradeName: z.string().optional().transform(v => v?.trim() || undefined),
    cep: z.string().optional().transform(v => v?.trim() || undefined),
    address: z.string().optional().transform(v => v?.trim() || undefined),
    number: z.string().optional().transform(v => v?.trim() || undefined),
    complement: z.string().optional().transform(v => v?.trim() || undefined),
    neighborhood: z.string().optional().transform(v => v?.trim() || undefined),
    city: z.string().optional().transform(v => v?.trim() || undefined),
    state: z.string().optional().transform(v => v?.trim()?.toUpperCase() || undefined),
    cityIbgeCode: z.string().optional().transform(v => v?.trim() || undefined),
    country: z.string().optional().default('BRASIL'),
    stateRegistration: stateRegistrationSchema,
    municipalRegistration: z.string().optional().transform(v => v?.trim() || undefined),
});

const updatePersonSchema = createPersonSchema.partial().extend({
    stateRegistration: z.preprocess(v => v === null || (typeof v === 'string' && !v.trim()) ? null : v, stateRegistrationSchema.nullable()).optional(),
    complement: z.string().trim().optional(),
    documentType: z.enum(['CPF', 'CNPJ']).optional(),
    document: z.string().min(1).transform(normalizeDocument).optional(),
    // RNTRC do transportador (ANTT). Vale para viagens ofertadas depois da mudança; viagens já
    // ofertadas/emitidas mantêm o RNTRC congelado no retrato da composição.
    rntrc: z.string().nullable().optional()
        .transform(v => (v == null ? v : v.replace(/\D/g, '') || null))
        .refine(v => v == null || /^\d{8,9}$/.test(v), 'RNTRC deve ter 8 ou 9 dígitos.'),
});

// POST /api/persons/sync - Backfill Person for Client/Link without personId (Admin only)
router.post('/sync', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        let clientsLinked = 0;
        let linksLinked = 0;

        const clients = await prisma.client.findMany({
            where: { personId: null },
            include: { accountCompany: true },
        });

        for (const client of clients) {
            const document = normalizeDocument(client.document);
            if (!document) continue;

            let person = await prisma.person.findUnique({
                where: { document },
            });

            if (!person) {
                person = await prisma.person.create({
                    data: {
                        documentType: 'CNPJ',
                        document,
                        legalName: client.companyName,
                        tradeName: client.tradeName ?? undefined,
                        address: client.accountCompany?.address ?? undefined,
                        city: client.accountCompany?.city ?? undefined,
                        state: client.accountCompany?.state ?? undefined,
                        country: 'BRASIL',
                    },
                });
            }

            await prisma.client.update({
                where: { id: client.id },
                data: { personId: person.id },
            });
            clientsLinked++;
        }

        const links = await prisma.link.findMany({
            where: { personId: null },
        });

        for (const link of links) {
            const document = normalizeDocument(link.document);
            if (!document) continue;

            let person = await prisma.person.findUnique({
                where: { document },
            });

            if (!person) {
                person = await prisma.person.create({
                    data: {
                        documentType: inferDocumentType(link.document),
                        document,
                        legalName: link.name,
                        country: 'BRASIL',
                    },
                });
            }

            await prisma.link.update({
                where: { id: link.id },
                data: { personId: person.id },
            });
            linksLinked++;
        }

        res.json({
            success: true,
            data: {
                clientsLinked,
                linksLinked,
                message: `Sincronização concluída: ${clientsLinked} cliente(s) e ${linksLinked} motorista(s) vinculados a pessoas.`,
            },
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/persons/search?q= - Search persons for autocomplete (Admin, HUB)
router.get('/search', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const q = (req.query.q as string)?.trim();
        if (!q || q.length < 2) {
            return res.json({ success: true, data: [] });
        }

        const docNorm = normalizeDocument(q);
        const normalizedQ = normalizeForSearch(q);
        const orConditions: Prisma.PersonWhereInput[] = [
            { legalName: { contains: q, mode: 'insensitive' } },
            { tradeName: { contains: q, mode: 'insensitive' } },
        ];
        if (docNorm.length >= 3) {
            orConditions.push({ document: { contains: docNorm } });
        }

        // Busca por nome ignorando pontuação (ex: "w da s" encontra "W. DA S. MESQUITA")
        // Pular raw SQL quando a query é só dígitos (CNPJ/CPF) – usar apenas Prisma document/legalName/tradeName
        const isDocumentOnly = normalizedQ === docNorm && docNorm.length >= 3;
        if (normalizedQ.length >= 2 && !isDocumentOnly) {
            const likePattern = '%' + normalizedQ.replace(/%/g, '\\%').replace(/_/g, '\\_') + '%';
            const rawRows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
                SELECT id FROM "Person"
                WHERE
                    LOWER(regexp_replace(regexp_replace(COALESCE("legalName", ''), '[-.,]', '', 'g'), '\s+', ' ', 'g')) LIKE ${likePattern}
                    OR ("tradeName" IS NOT NULL AND LOWER(regexp_replace(regexp_replace("tradeName", '[-.,]', '', 'g'), '\s+', ' ', 'g')) LIKE ${likePattern})
                LIMIT 15
            `);
            const normalizedIds = rawRows.map((r) => r.id);
            if (normalizedIds.length > 0) {
                orConditions.push({ id: { in: normalizedIds } });
            }
        }

        const documentType = req.query.documentType as string | undefined;
        const where: Prisma.PersonWhereInput = documentType === 'CPF' || documentType === 'CNPJ'
            ? { AND: [{ OR: orConditions }, { documentType }] }
            : { OR: orConditions };

        const persons = await prisma.person.findMany({
            where,
            include: {
                clients: { select: { id: true, companyName: true } },
                links: { select: { id: true, name: true } },
                drivers: {
                    select: {
                        id: true, active: true, name: true, phone: true, birthDate: true,
                        cnhNumber: true, cnhCategory: true, cnhExpiry: true, cnhState: true,
                    },
                },
                hubs: { select: { id: true, name: true } },
            },
            orderBy: { legalName: 'asc' },
            take: 15,
        });

        res.json({ success: true, data: persons.map((person) => ({ ...person, roles: personRoles(person) })) });
    } catch (error) {
        next(error);
    }
});

// GET /api/persons/lookup-document/:document - Consulta CPF/CNPJ antes de cadastrar (Admin, HUB).
// Pessoa já cadastrada → devolve ela (sem consulta externa). CNPJ novo → Sintegra/Receita como sugestão.
// Não cria nada.
router.get('/lookup-document/:document', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const document = normalizeDocument(String(req.params.document ?? ''));
        if (document.length !== 11 && document.length !== 14) {
            throw new AppError('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).', 400);
        }
        const existing = await prisma.person.findUnique({
            where: { document },
            include: {
                clients: { select: { id: true, companyName: true } },
                links: { select: { id: true, name: true } },
                drivers: {
                    select: {
                        id: true, active: true, name: true, phone: true, birthDate: true,
                        cnhNumber: true, cnhCategory: true, cnhExpiry: true, cnhState: true,
                    },
                },
                hubs: { select: { id: true, name: true } },
            },
        });
        if (existing && req.query.fresh !== '1') {
            return res.json({ success: true, data: { source: 'person', person: { ...existing, roles: personRoles(existing) }, suggestion: null } });
        }
        if (document.length === 14 && isValidCnpj(document)) {
            const found = await lookupCnpjSuggestion(document, { fresh: req.query.fresh === '1' });
            if (found) {
                return res.json({ success: true, data: { source: found.source, person: null, suggestion: found.suggestion } });
            }
        }
        res.json({ success: true, data: { source: 'none', person: null, suggestion: null } });
    } catch (error) {
        next(error);
    }
});

// GET /api/persons - List persons (Admin only)
router.get('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const documentType = req.query.documentType as string | undefined;
        const document = req.query.document as string | undefined;
        const name = req.query.name as string | undefined;
        const hasClient = req.query.hasClient as string | undefined;
        const hasLink = req.query.hasLink as string | undefined;

        const where: any = {};
        if (documentType === 'CPF' || documentType === 'CNPJ') {
            where.documentType = documentType;
        }
        if (document) {
            const docNorm = normalizeDocument(document);
            where.document = (docNorm.length === 11 || docNorm.length === 14)
                ? { equals: docNorm }
                : { contains: docNorm };
        }
        if (name) {
            where.OR = [
                { legalName: { contains: name, mode: 'insensitive' } },
                { tradeName: { contains: name, mode: 'insensitive' } },
            ];
        }
        if (hasClient === 'true') {
            where.clients = { some: {} };
        }
        if (hasClient === 'false') {
            where.clients = { none: {} };
        }
        if (hasLink === 'true') {
            where.links = { some: {} };
        }
        if (hasLink === 'false') {
            where.links = { none: {} };
        }

        const persons = await prisma.person.findMany({
            where,
            include: {
                _count: {
                    select: { clients: true, links: true, users: true },
                },
                clients: { select: { id: true, companyName: true, document: true } },
                links: { select: { id: true, name: true, document: true } },
            },
            orderBy: { legalName: 'asc' },
        });

        res.json({
            success: true,
            data: persons,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/persons/:id - Get person detail
router.get('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = getParamId(req.params);

        const person = await prisma.person.findUnique({
            where: { id },
            include: {
                clients: {
                    include: {
                        user: { select: { id: true, email: true, active: true } },
                    },
                },
                links: {
                    include: {
                        user: { select: { id: true, email: true, active: true } },
                        vehicleType: { select: { name: true, code: true } },
                    },
                },
                hubs: { select: { id: true, name: true, code: true } },
                fiscalEmitters: { select: { id: true, active: true } },
                contacts: { orderBy: { createdAt: 'asc' } },
                users: req.user!.roles.includes('ADMIN')
                    ? {
                          select: {
                              id: true,
                              email: true,
                              roles: true,
                              active: true,
                              hubId: true,
                              hub: { select: { id: true, name: true, code: true } },
                          },
                      }
                    : false,
            },
        });

        if (!person) {
            throw new AppError('Pessoa não encontrada', 404);
        }

        // Non-admin and non-hub can only view their own person (via client or link)
        if (!req.user!.roles.includes('ADMIN') && !req.user!.roles.includes('HUB')) {
            const isOwn =
                (req.user!.roles.includes('CLIENT') && person.clients.some(c => c.user?.id === req.user!.id)) ||
                (req.user!.roles.includes('LINK') && person.links.some(l => l.user?.id === req.user!.id));
            if (!isOwn) {
                throw new AppError('Não autorizado', 403);
            }
        }

        res.json({
            success: true,
            data: person,
        });
    } catch (error) {
        next(error);
    }
});

const createPersonContactSchema = z.object({
    name: z.string().min(1, 'Nome do contato é obrigatório').trim(),
    phone: z.string().optional().transform(v => v?.trim() || undefined),
    email: z.string().email('Email inválido').optional().or(z.literal('')).transform(v => v ? v.trim().toLowerCase() : undefined),
    role: z.string().optional().transform(v => v?.trim() || undefined),
    relation: z.string().optional().transform(v => v?.trim() || undefined),
});

// GET /api/persons/:id/contacts - Lista contatos da pessoa (Admin, Hub)
router.get('/:id/contacts', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = getParamId(req.params);
        const contacts = await prisma.personContact.findMany({
            where: { personId: id },
            orderBy: { createdAt: 'asc' },
        });
        res.json({ success: true, data: contacts });
    } catch (error) {
        next(error);
    }
});

// POST /api/persons/:id/contacts - Adiciona contato à pessoa (Admin, Hub)
router.post('/:id/contacts', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = getParamId(req.params);
        const body = createPersonContactSchema.parse(req.body);
        const person = await prisma.person.findUnique({ where: { id }, select: { id: true } });
        if (!person) throw new AppError('Pessoa não encontrada', 404);

        const contact = await prisma.personContact.create({
            data: {
                personId: id,
                name: body.name,
                phone: body.phone,
                email: body.email,
                relation: body.role || body.relation || null,
            },
        });
        res.status(201).json({ success: true, data: contact });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0]?.message ?? 'Payload inválido', 400));
        next(error);
    }
});

// POST /api/persons - Create person (Admin ou Hub)
router.post('/', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const body = createPersonSchema.parse(req.body);
        validateDocument(body.documentType, body.document);

        if (body.city || body.state || body.cityIbgeCode) {
            Object.assign(body, await validateSelectedCity(body));
        }

        if (body.cep && body.city && body.state && body.cityIbgeCode) Object.assign(body, await validateSelectedAddress({ ...body, cep: body.cep, city: body.city, state: body.state }));
        const existing = await prisma.person.findUnique({
            where: { document: body.document },
        });
        if (existing) {
            throw new AppError('Já existe uma pessoa com este documento', 400);
        }

        const person = await prisma.person.create({
            data: {
                documentType: body.documentType,
                document: body.document,
                legalName: body.legalName,
                tradeName: body.tradeName,
                cep: body.cep,
                address: body.address,
                number: body.number,
                complement: body.complement,
                neighborhood: body.neighborhood,
                city: body.city,
                state: body.state,
                cityIbgeCode: body.cityIbgeCode,
                country: body.country ?? 'BRASIL',
                stateRegistration: body.stateRegistration,
                municipalRegistration: body.municipalRegistration,
            },
        });

        res.status(201).json({
            success: true,
            data: person,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// POST /api/persons/from-public-cnpj - Pessoa pelo cadastro público do CNPJ (balcão do hub)
// Já cadastrada → devolve a existente; senão cria com razão social, endereço e cidade IBGE da Receita.
router.post('/from-public-cnpj', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { cnpj } = z.object({ cnpj: z.string().min(1) }).parse(req.body);
        const document = normalizeDocument(cnpj);
        validateDocument('CNPJ', document);
        const person = await ensurePublicCnpjPerson(document);
        if (!person) {
            throw new AppError('Não encontramos este CNPJ nos dados públicos agora. Cadastre manualmente.', 404);
        }
        res.json({ success: true, data: person });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// PATCH /api/persons/:id - Update person (Admin ou Hub, mesmo padrão de criação)
router.patch('/:id', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = getParamId(req.params);
        const body = updatePersonSchema.parse(req.body);

        const person = await prisma.person.findUnique({
            where: { id },
        });
        if (!person) {
            throw new AppError('Pessoa não encontrada', 404);
        }

        const document = body.document ?? person.document;
        const documentType = body.documentType ?? person.documentType;
        validateDocument(documentType, document);

        if (body.city !== undefined || body.state !== undefined || body.cityIbgeCode !== undefined) {
            Object.assign(body, await validateSelectedCity({
                city: body.city ?? person.city,
                state: body.state ?? person.state,
                cityIbgeCode: body.cityIbgeCode,
            }));
        }

        if (body.cep !== undefined || body.cityIbgeCode !== undefined) {
            const merged = { ...person, ...body };
            if (merged.cep && merged.city && merged.state && merged.cityIbgeCode) await validateSelectedAddress({ cep: merged.cep, city: merged.city, state: merged.state, cityIbgeCode: merged.cityIbgeCode });
        }

        if (body.document !== undefined || body.documentType !== undefined) {
            const existing = await prisma.person.findFirst({
                where: {
                    document,
                    id: { not: id },
                },
            });
            if (existing) {
                throw new AppError('Já existe outra pessoa com este documento', 400);
            }
        }
        const nextStateRegistration = body.stateRegistration !== undefined ? body.stateRegistration : person.stateRegistration;

        const isEmitter = (await prisma.fiscalEmitter.findFirst({
            where: { personId: id },
        })) || (await prisma.hub.findFirst({
            where: { personId: id },
        }));

        if (isEmitter && !nextStateRegistration) {
            throw new AppError('Esta pessoa é um emissor fiscal e deve possuir uma Inscrição Estadual válida ou ser marcada como ISENTO', 400);
        }
        const updated = await prisma.person.update({
            where: { id },
            data: {
                ...(body.documentType && { documentType: body.documentType }),
                ...(body.document && { document: body.document }),
                ...(body.legalName !== undefined && { legalName: body.legalName }),
                ...(body.tradeName !== undefined && { tradeName: body.tradeName }),
                ...(body.cep !== undefined && { cep: body.cep }),
                ...(body.address !== undefined && { address: body.address }),
                ...(body.number !== undefined && { number: body.number }),
                ...(body.complement !== undefined && { complement: body.complement }),
                ...(body.neighborhood !== undefined && { neighborhood: body.neighborhood }),
                ...(body.city !== undefined && { city: body.city }),
                ...(body.state !== undefined && { state: body.state }),
                ...(body.cityIbgeCode !== undefined && { cityIbgeCode: body.cityIbgeCode }),
                ...(body.country !== undefined && { country: body.country }),
                ...(body.stateRegistration !== undefined && { stateRegistration: body.stateRegistration }),
                ...(body.municipalRegistration !== undefined && { municipalRegistration: body.municipalRegistration }),
                ...(body.rntrc !== undefined && { rntrc: body.rntrc }),
            },
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

// POST /api/persons/:id/add-client - Add Person as Client (create User + Client)
router.post('/:id/add-client', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = getParamId(req.params);
        const body = addClientSchema.parse(req.body);

        const person = await prisma.person.findUnique({
            where: { id },
        });
        if (!person) {
            throw new AppError('Pessoa não encontrada', 404);
        }
        if (person.documentType !== 'CNPJ') {
            throw new AppError('Apenas pessoa jurídica (CNPJ) pode ser adicionada como Cliente', 400);
        }

        const existingUser = await prisma.user.findUnique({
            where: { email: body.email },
        });
        if (existingUser) {
            throw new AppError('Email já cadastrado', 400);
        }

        const existingClient = await prisma.client.findFirst({
            where: { personId: id },
        });
        if (existingClient) {
            throw new AppError('Esta pessoa já possui vínculo como Cliente', 400);
        }

        const hashedPassword = await bcrypt.hash(body.password, 10);

        const result = await prisma.$transaction(async (tx) => {
            const account = await tx.account.create({
                data: {
                    name: person.legalName,
                    accountType: 'COMPANY',
                    companies: {
                        create: {
                            cnpj: person.document,
                            legalName: person.legalName,
                            tradeName: person.tradeName ?? undefined,
                            address: person.address ?? undefined,
                            city: person.city ?? undefined,
                            state: person.state ?? undefined,
                            isPrimary: true,
                        }
                    },
                    contacts: {
                        create: {
                            name: body.contactName,
                            phone: body.phone,
                            isPrimary: true,
                        }
                    }
                },
                include: {
                    companies: { where: { isPrimary: true }, take: 1 },
                }
            });

            const user = await tx.user.create({
                data: {
                    email: body.email,
                    password: hashedPassword,
                    roles: ['CLIENT'],
                    accountId: account.id,
                    personId: id,
                }
            });

            const client = await tx.client.create({
                data: {
                    userId: user.id,
                    personId: id,
                    accountId: account.id,
                    accountCompanyId: account.companies[0].id,
                    companyName: person.legalName,
                    tradeName: person.tradeName ?? undefined,
                    document: person.document,
                    contactName: body.contactName,
                    phone: body.phone,
                }
            });

            return { user, client, account };
        });

        res.status(201).json({
            success: true,
            data: {
                id: result.client.id,
                userId: result.user.id,
                companyName: result.client.companyName,
                document: result.client.document,
            }
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// POST /api/persons/:id/add-client-pending - Add Person as Client with placeholders, create Opportunity for Comercial
router.post('/:id/add-client-pending', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = getParamId(req.params);

        const person = await prisma.person.findUnique({
            where: { id },
        });
        if (!person) {
            throw new AppError('Pessoa não encontrada', 404);
        }
        if (person.documentType !== 'CNPJ') {
            throw new AppError('Apenas pessoa jurídica (CNPJ) pode ser adicionada como Cliente', 400);
        }

        const existingClient = await prisma.client.findFirst({
            where: { personId: id },
        });
        if (existingClient) {
            throw new AppError('Esta pessoa já possui vínculo como Cliente', 400);
        }

        const placeholderEmail = `pendente-${id}@comercial.tsmex.local`;
        const existingUser = await prisma.user.findUnique({
            where: { email: placeholderEmail },
        });
        if (existingUser) {
            throw new AppError('Email placeholder já existe - operação em andamento', 400);
        }

        const randomPassword = crypto.randomBytes(16).toString('hex');
        const hashedPassword = await bcrypt.hash(randomPassword, 10);
        const sessionId = `entrada-pending-${id}-${Date.now()}`;

        const concluirCadastroColumn = await findOrCreateConcluirCadastroColumn();

        const result = await prisma.$transaction(async (tx) => {
            const account = await tx.account.create({
                data: {
                    name: person.legalName,
                    accountType: 'COMPANY',
                    companies: {
                        create: {
                            cnpj: person.document,
                            legalName: person.legalName,
                            tradeName: person.tradeName ?? undefined,
                            address: person.address ?? undefined,
                            city: person.city ?? undefined,
                            state: person.state ?? undefined,
                            isPrimary: true,
                        }
                    },
                    contacts: {
                        create: {
                            name: 'A concluir pelo Comercial',
                            phone: '00000000000',
                            isPrimary: true,
                        }
                    }
                },
                include: {
                    companies: { where: { isPrimary: true }, take: 1 },
                }
            });

            const user = await tx.user.create({
                data: {
                    email: placeholderEmail,
                    password: hashedPassword,
                    roles: ['CLIENT'],
                    accountId: account.id,
                    personId: id,
                }
            });

            const client = await tx.client.create({
                data: {
                    userId: user.id,
                    personId: id,
                    accountId: account.id,
                    accountCompanyId: account.companies[0].id,
                    companyName: person.legalName,
                    tradeName: person.tradeName ?? undefined,
                    document: person.document,
                    contactName: 'A concluir pelo Comercial',
                    phone: '00000000000',
                }
            });

            const opportunity = await tx.opportunity.create({
                data: {
                    accountId: account.id,
                    sessionId,
                    source: 'ENTRADA',
                    stage: 'FOLLOW_UP',
                    completeness: 'INCOMPLETE',
                    type: 'QUOTE_ONLY',
                    cpfCnpjSender: person.document,
                    cpfCnpjReceiver: person.document,
                    pipelineColumnId: concluirCadastroColumn.id,
                }
            });

            return { user, client, account, opportunity };
        });

        res.status(201).json({
            success: true,
            data: {
                clientId: result.client.id,
                opportunityId: result.opportunity.id,
                companyName: result.client.companyName,
                document: result.client.document,
            }
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/persons/:id/add-link - Add Person as Link (Motorista)
router.post('/:id/add-link', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = getParamId(req.params);
        const body = addLinkSchema.parse(req.body);

        const person = await prisma.person.findUnique({
            where: { id },
        });
        if (!person) {
            throw new AppError('Pessoa não encontrada', 404);
        }

        const existingUser = await prisma.user.findUnique({
            where: { email: body.email },
        });
        if (existingUser) {
            throw new AppError('Email já cadastrado', 400);
        }

        const existingLink = await prisma.link.findFirst({
            where: { personId: id },
        });
        if (existingLink) {
            throw new AppError('Esta pessoa já possui vínculo como Motorista', 400);
        }

        const hashedPassword = await bcrypt.hash(body.password, 10);

        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    email: body.email,
                    password: hashedPassword,
                    roles: ['LINK'],
                    personId: person.id,
                }
            });

            const link = await tx.link.create({
                data: {
                    userId: user.id,
                    personId: id,
                    name: body.name,
                    document: person.document,
                    phone: body.phone,
                    vehicleTypeId: body.vehicleTypeId,
                    vehiclePlate: body.vehiclePlate,
                    homeBase: body.homeBase,
                    coverageStates: [],
                }
            });

            return { user, link };
        });

        res.status(201).json({
            success: true,
            data: {
                id: result.link.id,
                userId: result.user.id,
                name: result.link.name,
                document: result.link.document,
            }
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// POST /api/persons/:id/add-hub - Add Person as Hub operator (create User HUB)
// POST /api/persons/:id/as-driver - Usa a pessoa como motorista (cria o papel a partir dela)
router.post('/:id/as-driver', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = getParamId(req.params);
        const body = asDriverSchema.parse(req.body ?? {});

        const person = await prisma.person.findUnique({
            where: { id },
            include: {
                drivers: true,
                contacts: { select: { phone: true } },
            },
        });
        if (!person) throw new AppError('Pessoa não encontrada', 404);

        if (body.linkId) {
            const link = await prisma.link.findUnique({ where: { id: body.linkId }, select: { id: true } });
            if (!link) throw new AppError('Transportador não encontrado', 404);
        }

        let driver = person.drivers[0] ?? null;
        let created = false;
        if (driver) {
            if (!driver.active && !driver.blockedReason) {
                driver = await prisma.driver.update({ where: { id: driver.id }, data: { active: true } });
            }
        } else {
            const cpf = normalizeDocument(person.document);
            if (person.documentType !== 'CPF' || cpf.length !== 11) {
                throw new AppError('Só pessoa física (CPF) pode ser motorista', 400);
            }
            const phone = person.contacts.map((c) => c.phone).find((v): v is string => Boolean(v)) ?? '';
            driver = await prisma.driver.create({
                data: { name: person.legalName, document: cpf, phone, personId: person.id, active: true },
            });
            created = true;
        }

        if (body.linkId) {
            await prisma.driverCarrier.upsert({
                where: { driverId_linkId: { driverId: driver.id, linkId: body.linkId } },
                create: { driverId: driver.id, linkId: body.linkId },
                update: { active: true },
            });
        }

        const missingForCiot: string[] = [];
        if (!driver.cnhNumber) missingForCiot.push('número da CNH');
        if (!driver.cnhCategory) missingForCiot.push('categoria da CNH');
        if (!driver.cnhExpiry) missingForCiot.push('validade da CNH');
        if (!driver.birthDate) missingForCiot.push('data de nascimento');
        if (!driver.phone) missingForCiot.push('telefone');

        res.status(created ? 201 : 200).json({ success: true, data: { driver, created, missingForCiot } });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

router.post('/:id/add-hub', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = getParamId(req.params);
        const body = addHubUserSchema.parse(req.body);

        const person = await prisma.person.findUnique({
            where: { id },
        });
        if (!person) {
            throw new AppError('Pessoa não encontrada', 404);
        }

        const hub = await prisma.hub.findUnique({
            where: { id: body.hubId },
        });
        if (!hub || !hub.active) {
            throw new AppError('Hub não encontrado ou inativo', 404);
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
                personId: id,
                hubId: body.hubId,
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

export { router as personsRouter };
