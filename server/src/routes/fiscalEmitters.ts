import crypto from 'crypto';
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { uploadBase64Object } from '../lib/objectStorage.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import {
    buildFiscalEmitterReadiness,
    encryptCertificatePassword,
    getCertificateStatus,
} from '../services/fiscalEmitterService.js';

const router = Router();

const fiscalEmitterSchema = z.object({
    personId: z.string().uuid(),
    hubId: z.string().uuid().nullable().optional(),
    displayName: z.string().max(500).nullable().optional(),
    tradeName: z.string().max(500).nullable().optional(),
    logoUrl: z.string().url().max(2048).nullable().optional(),
    logoStorageKey: z.string().max(1024).nullable().optional(),
    footerNote: z.string().max(2000).nullable().optional(),
    rntrc: z.string().max(64).nullable().optional(),
    taxRegime: z.enum(['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'MEI', 'OUTRO']).nullable().optional(),
    crt: z.string().max(8).nullable().optional(),
    cteSeries: z.number().int().positive().optional(),
    lastCteNumber: z.number().int().min(0).optional(),
    lastMinutaNumber: z.number().int().min(0).optional(),
    environment: z.enum(['HOMOLOGACAO', 'PRODUCAO']).optional(),
    provider: z.enum(['SIMULATED', 'NUVEM_FISCAL', 'FOCUS_NFE', 'TECNOSPEED', 'PLUGNOTAS', 'OTHER']).optional(),
    providerEmitterId: z.string().max(256).nullable().optional(),
    providerStatus: z.enum(['NOT_CONFIGURED', 'PENDING', 'READY', 'ERROR']).optional(),
    active: z.boolean().optional(),
    defaultForHub: z.boolean().optional(),
});

const certificateSchema = z.object({
    file: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().optional(),
    password: z.string().min(1),
    expiresAt: z.string().datetime().nullable().optional(),
});

function toPublicEmitter(emitter: any) {
    const {
        certificatePasswordEncrypted: _secret,
        certificateStorageKey: _storageKey,
        ...safe
    } = emitter;
    return {
        ...safe,
        readiness: buildFiscalEmitterReadiness({
            person: safe.person,
            rntrc: safe.rntrc,
            crt: safe.crt,
            cteSeries: safe.cteSeries,
            environment: safe.environment,
            certificateStorageKey: safe.certificateStorageKey,
            certificatePasswordEncrypted: emitter.certificatePasswordEncrypted,
        }),
    };
}

function buildEmitterWhereForUser(req: AuthRequest) {
    const isAdmin = req.user?.roles.includes('ADMIN') ?? false;
    const hubId = req.user?.hubId;
    if (isAdmin) return {};
    if (req.user?.roles.includes('HUB') && hubId) {
        return { OR: [{ hubId }, { hubId: null }] };
    }
    return { id: '__forbidden__' };
}

async function assertPersonAndHub(data: { personId: string; hubId?: string | null }) {
    const person = await prisma.person.findUnique({ where: { id: data.personId } });
    if (!person) throw new AppError('Pessoa do emitente não encontrada', 404);
    if (person.documentType !== 'CNPJ') throw new AppError('Emitente credenciado precisa ser Pessoa Jurídica (CNPJ)', 400);

    if (data.hubId) {
        const hub = await prisma.hub.findUnique({ where: { id: data.hubId } });
        if (!hub) throw new AppError('Hub vinculado não encontrado', 404);
    }
}

router.get('/', authenticate, authorize('ADMIN', 'HUB'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const emitters = await prisma.fiscalEmitter.findMany({
            where: buildEmitterWhereForUser(_req),
            include: { person: true, hub: true },
            orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
        });
        res.json({ success: true, data: emitters.map(toPublicEmitter) });
    } catch (error) {
        next(error);
    }
});

router.get('/:id', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const emitter = await prisma.fiscalEmitter.findUnique({
            where: { id },
            include: { person: true, hub: true },
        });
        if (!emitter) throw new AppError('Emitente credenciado não encontrado', 404);
        const isAdmin = req.user?.roles.includes('ADMIN') ?? false;
        if (!isAdmin && req.user?.roles.includes('HUB') && emitter.hubId && emitter.hubId !== req.user.hubId) {
            throw new AppError('Not authorized to access this fiscal emitter', 403);
        }
        res.json({ success: true, data: toPublicEmitter(emitter) });
    } catch (error) {
        next(error);
    }
});

router.post('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = fiscalEmitterSchema.parse(req.body);
        await assertPersonAndHub(data);

        const emitter = await prisma.fiscalEmitter.create({
            data: {
                ...data,
                hubId: data.hubId ?? null,
                displayName: data.displayName ?? null,
                tradeName: data.tradeName ?? null,
                logoUrl: data.logoUrl ?? null,
                logoStorageKey: data.logoStorageKey ?? null,
                footerNote: data.footerNote ?? null,
                rntrc: data.rntrc ?? null,
                taxRegime: data.taxRegime ?? null,
                crt: data.crt ?? null,
                cteSeries: data.cteSeries ?? 1,
                environment: data.environment ?? 'HOMOLOGACAO',
            },
            include: { person: true, hub: true },
        });

        res.status(201).json({ success: true, data: toPublicEmitter(emitter) });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

router.patch('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const data = fiscalEmitterSchema.partial().parse(req.body);
        const current = await prisma.fiscalEmitter.findUnique({ where: { id } });
        if (!current) throw new AppError('Emitente credenciado não encontrado', 404);

        if (data.personId || data.hubId !== undefined) {
            await assertPersonAndHub({ personId: data.personId ?? current.personId, hubId: data.hubId ?? null });
        }

        const emitter = await prisma.fiscalEmitter.update({
            where: { id },
            data,
            include: { person: true, hub: true },
        });
        res.json({ success: true, data: toPublicEmitter(emitter) });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

router.post('/:id/certificate', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const data = certificateSchema.parse(req.body);
        const emitter = await prisma.fiscalEmitter.findUnique({ where: { id } });
        if (!emitter) throw new AppError('Emitente credenciado não encontrado', 404);

        const lowerName = data.filename.toLowerCase();
        if (!lowerName.endsWith('.pfx') && !lowerName.endsWith('.p12')) {
            throw new AppError('Certificado A1 deve ser .pfx ou .p12', 400);
        }

        const upload = await uploadBase64Object({
            base64: data.file,
            fileName: data.filename,
            mimeType: data.mimeType ?? 'application/x-pkcs12',
            keyPrefix: `fiscal/emitters/${emitter.id}/certificates`,
        });

        const passwordEncrypted = encryptCertificatePassword(data.password);
        const updated = await prisma.fiscalEmitter.update({
            where: { id: emitter.id },
            data: {
                certificateStorageKey: upload.storageKey,
                certificateFileName: data.filename,
                certificatePasswordEncrypted: passwordEncrypted,
                certificateExpiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
                certificateFingerprint: crypto.createHash('sha256').update(upload.checksum).digest('hex'),
                certificateStatus: getCertificateStatus({
                    certificateStorageKey: upload.storageKey,
                    certificatePasswordEncrypted: passwordEncrypted,
                    certificateExpiresAt: data.expiresAt ?? null,
                }),
            },
            include: { person: true, hub: true },
        });

        res.json({ success: true, data: toPublicEmitter(updated) });
    } catch (error) {
        if (error instanceof z.ZodError) return next(new AppError(error.errors[0].message, 400));
        next(error);
    }
});

router.get('/:id/readiness', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const emitter = await prisma.fiscalEmitter.findUnique({
            where: { id },
            include: { person: true, hub: true },
        });
        if (!emitter) throw new AppError('Emitente credenciado não encontrado', 404);
        const isAdmin = req.user?.roles.includes('ADMIN') ?? false;
        if (!isAdmin && req.user?.roles.includes('HUB') && emitter.hubId && emitter.hubId !== req.user.hubId) {
            throw new AppError('Not authorized to access this fiscal emitter', 403);
        }
        res.json({ success: true, data: toPublicEmitter(emitter).readiness });
    } catch (error) {
        next(error);
    }
});

export { router as fiscalEmittersRouter };
