import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';

const router = Router();

const createSchema = z.object({
    name: z.string().min(1, 'Nome é obrigatório'),
    active: z.boolean().default(true),
});

const updateSchema = createSchema.partial();

// GET /api/nf-species - Listar espécies ativas
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { active } = req.query;

        const species = await prisma.nfSpecies.findMany({
            where: active !== undefined ? { active: active === 'true' } : undefined,
            orderBy: { name: 'asc' },
        });

        res.json({
            success: true,
            data: species,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/nf-species - Criar espécie (Admin)
router.post('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = createSchema.parse(req.body);

        const existing = await prisma.nfSpecies.findUnique({
            where: { name: data.name.trim() },
        });

        if (existing) {
            throw new AppError('Espécie já existe', 400);
        }

        const species = await prisma.nfSpecies.create({
            data: { name: data.name.trim(), active: data.active },
        });

        res.status(201).json({
            success: true,
            data: species,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// PATCH /api/nf-species/:id - Atualizar espécie (Admin)
router.patch('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const data = updateSchema.parse(req.body);

        if (data.name !== undefined) {
            const existing = await prisma.nfSpecies.findFirst({
                where: { name: data.name.trim(), id: { not: id } },
            });
            if (existing) {
                throw new AppError('Espécie já existe', 400);
            }
        }

        const species = await prisma.nfSpecies.update({
            where: { id },
            data: data.name !== undefined ? { ...data, name: data.name.trim() } : data,
        });

        res.json({
            success: true,
            data: species,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// DELETE /api/nf-species/:id - Desativar espécie (Admin)
router.delete('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        await prisma.nfSpecies.update({
            where: { id },
            data: { active: false },
        });

        res.json({
            success: true,
            message: 'Espécie desativada',
        });
    } catch (error) {
        next(error);
    }
});

export { router as nfSpeciesRouter };
