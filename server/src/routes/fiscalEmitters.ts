import crypto from 'crypto';
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { uploadBase64Object } from '../lib/objectStorage.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { resolveStoredLogoUrl } from '../services/visualIdentityService.js';
import {
    buildFiscalEmitterReadiness,
    encryptCertificatePassword,
    getCertificateStatus,
} from '../services/fiscalEmitterService.js';
import { getObjectDownloadUrl } from '../lib/objectStorage.js';
import { isAcbrCredentialsConfigured } from '../services/acbr/acbrConfig.js';
import { putAcbrEmpresaCertificado, syncFiscalEmitterToAcbr } from '../services/acbr/acbrEmpresa.js';

const router = Router();

function digitsOnly(s: string): string {
    return s.replace(/\D/g, '');
}

/** Sincroniza empresa + config CT-e na ACBr quando emitente é ACBR e credenciais globais existem. */
async function trySyncAcbrEmitter(emitterId: string): Promise<{ acbrSync?: { ok: boolean; message?: string } }> {
    const e = await prisma.fiscalEmitter.findUnique({ where: { id: emitterId }, include: { person: true } });
    if (!e || e.provider !== 'ACBR' || !isAcbrCredentialsConfigured()) {
        return {};
    }
    const env = e.environment === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';
    const sync = await syncFiscalEmitterToAcbr({ environment: env, crt: e.crt, person: e.person });
    if (sync.ok) {
        await prisma.fiscalEmitter.update({
            where: { id: emitterId },
            data: {
                providerEmitterId: digitsOnly(e.person.document),
                providerStatus: 'READY',
            },
        });
    } else {
        await prisma.fiscalEmitter.update({
            where: { id: emitterId },
            data: { providerStatus: 'ERROR' },
        });
    }
    return { acbrSync: { ok: sync.ok, message: sync.message } };
}

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
    lastDceNumber: z.number().int().min(0).optional(),
    lastMinutaNumber: z.number().int().min(0).optional(),
    environment: z.enum(['HOMOLOGACAO', 'PRODUCAO']).optional(),
    provider: z.enum(['SIMULATED', 'ACBR', 'NUVEM_FISCAL', 'FOCUS_NFE', 'TECNOSPEED', 'PLUGNOTAS', 'OTHER']).optional(),
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

async function toPublicEmitter(emitter: any) {
    const {
        certificatePasswordEncrypted: _secret,
        certificateStorageKey: _storageKey,
        ...safe
    } = emitter;
    return {
        ...safe,
        logoUrl: await resolveStoredLogoUrl(safe.logoUrl ?? null, safe.logoStorageKey ?? null),
        readiness: buildFiscalEmitterReadiness({
            person: safe.person,
            rntrc: safe.rntrc,
            crt: safe.crt,
            cteSeries: safe.cteSeries,
            environment: safe.environment,
            certificateStorageKey: _storageKey,
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

router.get('/', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const baseWhere = buildEmitterWhereForUser(req);
        const hubIdParam = typeof req.query.hubId === 'string' ? req.query.hubId.trim() : '';
        const hubScope =
            hubIdParam && (req.user?.roles.includes('ADMIN') ?? false)
                ? { OR: [{ hubId: hubIdParam }, { hubId: null }] }
                : null;
        const where =
            hubScope && Object.keys(baseWhere).length > 0
                ? { AND: [baseWhere, hubScope] }
                : hubScope ?? baseWhere;

        const emitters = await prisma.fiscalEmitter.findMany({
            where,
            include: { person: true, hub: true },
            orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
        });
        res.json({ success: true, data: await Promise.all(emitters.map(toPublicEmitter)) });
    } catch (error) {
        next(error);
    }
});

/** Link assinado (curta duração) para baixar o PFX — só ADMIN; use auditoria nos logs de acesso. */
router.get('/:id/certificate-download', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const emitter = await prisma.fiscalEmitter.findUnique({
            where: { id },
            select: {
                certificateStorageKey: true,
                certificateFileName: true,
            },
        });
        if (!emitter?.certificateStorageKey) {
            throw new AppError('Nenhum certificado A1 armazenado para este emitente', 404);
        }
        const expiresInSeconds = 900;
        const downloadUrl = await getObjectDownloadUrl(emitter.certificateStorageKey, expiresInSeconds);
        res.json({
            success: true,
            data: {
                downloadUrl,
                filename: emitter.certificateFileName ?? 'certificado.pfx',
                expiresInSeconds,
            },
        });
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
        res.json({ success: true, data: await toPublicEmitter(emitter) });
    } catch (error) {
        next(error);
    }
});

router.post('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = fiscalEmitterSchema.parse(req.body);
        await assertPersonAndHub(data);

        const { provider, providerEmitterId, providerStatus, ...restCreate } = data;
        const emitter = await prisma.fiscalEmitter.create({
            data: {
                ...restCreate,
                provider: provider ?? 'SIMULATED',
                providerEmitterId: providerEmitterId ?? null,
                providerStatus: providerStatus ?? (provider === 'ACBR' ? 'PENDING' : 'NOT_CONFIGURED'),
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

        const acbrExtra = await trySyncAcbrEmitter(emitter.id);
        const fresh = await prisma.fiscalEmitter.findUnique({
            where: { id: emitter.id },
            include: { person: true, hub: true },
        });

        res.status(201).json({ success: true, data: await toPublicEmitter(fresh!), ...acbrExtra });
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
        const acbrExtra = await trySyncAcbrEmitter(emitter.id);
        const fresh = await prisma.fiscalEmitter.findUnique({
            where: { id },
            include: { person: true, hub: true },
        });
        res.json({ success: true, data: await toPublicEmitter(fresh!), ...acbrExtra });
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

        let acbrCert: { ok: boolean; message?: string } | undefined;
        if (updated.provider === 'ACBR' && isAcbrCredentialsConfigured()) {
            const env = updated.environment === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';
            const certRes = await putAcbrEmpresaCertificado(updated.person, env, data.file, data.password);
            acbrCert = { ok: certRes.ok, message: certRes.message };
            await prisma.fiscalEmitter.update({
                where: { id: updated.id },
                data: { providerStatus: certRes.ok ? 'READY' : 'ERROR' },
            });
        }

        const afterCert = await prisma.fiscalEmitter.findUnique({
            where: { id: updated.id },
            include: { person: true, hub: true },
        });

        res.json({
            success: true,
            data: await toPublicEmitter(afterCert!),
            ...(acbrCert ? { acbrCertificate: acbrCert } : {}),
        });
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
        const publicEmitter = await toPublicEmitter(emitter);
        res.json({ success: true, data: publicEmitter.readiness });
    } catch (error) {
        next(error);
    }
});

export { router as fiscalEmittersRouter };
