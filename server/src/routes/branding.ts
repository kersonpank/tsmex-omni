import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { toBrandingPublic, VISUAL_IDENTITY_ID } from '../services/visualIdentityService.js';

const patchSchema = z.object({
  legalName: z.string().max(500).nullable().optional(),
  tradeName: z.string().max(500).nullable().optional(),
  cnpjDisplay: z.string().max(32).nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  email: z.string().email().max(256).nullable().optional(),
  addressLine: z.string().max(1000).nullable().optional(),
  footerNote: z.string().max(2000).nullable().optional(),
  logoUrl: z.string().url().max(2048).nullable().optional(),
  logoStorageKey: z.string().max(1024).nullable().optional(),
});

const emptyRow = () => ({
  legalName: null as string | null,
  tradeName: null,
  cnpjDisplay: null,
  phone: null,
  email: null,
  addressLine: null,
  footerNote: null,
  logoUrl: null,
  logoStorageKey: null,
});

const router = Router();

// GET /api/settings/branding — leitura (admin e hub, para documentos e tela)
router.get('/', authenticate, authorize('ADMIN', 'HUB'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const row = await prisma.visualIdentity.findUnique({ where: { id: VISUAL_IDENTITY_ID } });
    if (!row) {
      return res.json({ success: true, data: emptyRow() });
    }
    res.json({
      success: true,
      data: { ...toBrandingPublic(row), logoStorageKey: row.logoStorageKey },
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/settings/branding — apenas admin
router.patch('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = patchSchema.parse(req.body);

    const update: Record<string, string | null> = {};
    if (body.legalName !== undefined) update.legalName = body.legalName;
    if (body.tradeName !== undefined) update.tradeName = body.tradeName;
    if (body.cnpjDisplay !== undefined) update.cnpjDisplay = body.cnpjDisplay;
    if (body.phone !== undefined) update.phone = body.phone;
    if (body.email !== undefined) update.email = body.email;
    if (body.addressLine !== undefined) update.addressLine = body.addressLine;
    if (body.footerNote !== undefined) update.footerNote = body.footerNote;
    if (body.logoUrl !== undefined) update.logoUrl = body.logoUrl;
    if (body.logoStorageKey !== undefined) update.logoStorageKey = body.logoStorageKey;

    const createDefaults = {
      legalName: (update.legalName ?? null) as string | null,
      tradeName: (update.tradeName ?? null) as string | null,
      cnpjDisplay: (update.cnpjDisplay ?? null) as string | null,
      phone: (update.phone ?? null) as string | null,
      email: (update.email ?? null) as string | null,
      addressLine: (update.addressLine ?? null) as string | null,
      footerNote: (update.footerNote ?? null) as string | null,
      logoUrl: (update.logoUrl ?? null) as string | null,
      logoStorageKey: (update.logoStorageKey ?? null) as string | null,
    };

    const row = await prisma.visualIdentity.upsert({
      where: { id: VISUAL_IDENTITY_ID },
      create: { id: VISUAL_IDENTITY_ID, ...createDefaults },
      update,
    });

    res.json({
      success: true,
      data: { ...toBrandingPublic(row), logoStorageKey: row.logoStorageKey },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(error.errors[0].message, 400));
    }
    next(error);
  }
});

export { router as brandingRouter };
