import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';

const router = Router();

// ==================== GET COLUMNS ====================

// GET /api/pipeline/columns - List all columns
router.get('/columns', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const columns = await prisma.pipelineColumn.findMany({
            where: { active: true },
            orderBy: { order: 'asc' },
            include: {
                _count: {
                    select: { opportunities: true }
                }
            }
        });

        // Se não há colunas, criar colunas padrão
        if (columns.length === 0) {
            const defaultColumns = await createDefaultColumns();
            res.json({
                success: true,
                data: defaultColumns,
            });
            return;
        }

        res.json({
            success: true,
            data: columns,
        });
    } catch (error) {
        next(error);
    }
});

// Helper function to create default columns
async function createDefaultColumns() {
    const stages: Array<{ stage: any; name: string; color: string; order: number }> = [
        { stage: 'QUOTE', name: 'Cotação', color: '#3B82F6', order: 0 },
        { stage: 'FOLLOW_UP', name: 'Follow-up', color: '#F59E0B', order: 1 },
        { stage: null, name: 'Concluir cadastro do cliente', color: '#EA580C', order: 2 },
        { stage: 'COLLECTION_REQUESTED', name: 'Coleta Solicitada', color: '#8B5CF6', order: 3 },
        { stage: 'CONVERTED', name: 'Convertida', color: '#10B981', order: 4 },
        { stage: 'LOST', name: 'Perdida', color: '#6B7280', order: 5 },
    ];

    const created = await prisma.$transaction(
        stages.map((s) =>
            prisma.pipelineColumn.create({
                data: {
                    name: s.name,
                    color: s.color,
                    stage: s.stage,
                    order: s.order,
                }
            })
        )
    );

    return created;
}

/** Find or create "Concluir cadastro do cliente" column (for add-client-pending) */
export async function findOrCreateConcluirCadastroColumn() {
    let col = await prisma.pipelineColumn.findFirst({
        where: { name: 'Concluir cadastro do cliente', active: true },
    });
    if (!col) {
        const maxOrder = await prisma.pipelineColumn.aggregate({ _max: { order: true } });
        col = await prisma.pipelineColumn.create({
            data: {
                name: 'Concluir cadastro do cliente',
                color: '#EA580C',
                stage: null,
                order: (maxOrder._max.order ?? -1) + 1,
            },
        });
    }
    return col;
}

// ==================== CREATE COLUMN ====================

// POST /api/pipeline/columns - Create new column
router.post('/columns', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const schema = z.object({
            name: z.string().min(1, 'Name is required'),
            color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color').default('#3B82F6'),
            stage: z.enum(['QUOTE', 'FOLLOW_UP', 'COLLECTION_REQUESTED', 'CONVERTED', 'LOST']).optional(),
            filters: z.any().optional(),
        });

        const data = schema.parse(req.body);

        // Get max order
        const maxOrder = await prisma.pipelineColumn.findFirst({
            orderBy: { order: 'desc' },
            select: { order: true }
        });

        const column = await prisma.pipelineColumn.create({
            data: {
                ...data,
                order: (maxOrder?.order ?? -1) + 1,
            },
            include: {
                _count: {
                    select: { opportunities: true }
                }
            }
        });

        res.status(201).json({
            success: true,
            data: column,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// ==================== UPDATE COLUMN ====================

// PATCH /api/pipeline/columns/:id - Update column
router.patch('/columns/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const schema = z.object({
            name: z.string().min(1).optional(),
            color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
            stage: z.enum(['QUOTE', 'FOLLOW_UP', 'COLLECTION_REQUESTED', 'CONVERTED', 'LOST']).optional().nullable(),
            filters: z.any().optional(),
            active: z.boolean().optional(),
        });

        const data = schema.parse(req.body);

        const column = await prisma.pipelineColumn.update({
            where: { id },
            data,
            include: {
                _count: {
                    select: { opportunities: true }
                }
            }
        });

        res.json({
            success: true,
            data: column,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// ==================== DELETE COLUMN ====================

// DELETE /api/pipeline/columns/:id - Delete column (only custom columns, not stage-based)
router.delete('/columns/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const column = await prisma.pipelineColumn.findUnique({
            where: { id }
        });

        if (!column) {
            throw new AppError('Column not found', 404);
        }

        // Não permitir deletar colunas baseadas em stage (apenas desativar)
        if (column.stage) {
            await prisma.pipelineColumn.update({
                where: { id },
                data: { active: false }
            });
        } else {
            // Mover oportunidades para coluna padrão (QUOTE) antes de deletar
            const defaultColumn = await prisma.pipelineColumn.findFirst({
                where: { stage: 'QUOTE' }
            });

            if (defaultColumn) {
                await prisma.opportunity.updateMany({
                    where: { pipelineColumnId: id },
                    data: { pipelineColumnId: defaultColumn.id }
                });
            }

            await prisma.pipelineColumn.delete({
                where: { id }
            });
        }

        res.json({
            success: true,
            message: 'Column deleted successfully',
        });
    } catch (error) {
        next(error);
    }
});

// ==================== REORDER COLUMNS ====================

// PATCH /api/pipeline/columns/reorder - Reorder columns
router.patch('/columns/reorder', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const schema = z.object({
            columnIds: z.array(z.string().uuid()).min(1, 'At least one column ID is required'),
        });

        const { columnIds } = schema.parse(req.body);

        await prisma.$transaction(
            columnIds.map((id, index) =>
                prisma.pipelineColumn.update({
                    where: { id },
                    data: { order: index }
                })
            )
        );

        const columns = await prisma.pipelineColumn.findMany({
            where: { active: true },
            orderBy: { order: 'asc' },
            include: {
                _count: {
                    select: { opportunities: true }
                }
            }
        });

        res.json({
            success: true,
            data: columns,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// ==================== MOVE OPPORTUNITY ====================

// PATCH /api/pipeline/opportunities/:id/move-column - Move opportunity to another column
router.patch('/opportunities/:id/move-column', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const schema = z.object({
            columnId: z.string().uuid(),
        });

        const { columnId } = schema.parse(req.body);

        const column = await prisma.pipelineColumn.findUnique({
            where: { id: columnId }
        });

        if (!column || !column.active) {
            throw new AppError('Column not found or inactive', 404);
        }

        const opportunity = await prisma.opportunity.findUnique({
            where: { id }
        });

        if (!opportunity) {
            throw new AppError('Opportunity not found', 404);
        }

        // Se a coluna está baseada em stage, atualizar stage também
        const updateData: any = {
            pipelineColumnId: columnId
        };

        if (column.stage && column.stage !== opportunity.stage) {
            updateData.stage = column.stage;
        }

        const updated = await prisma.opportunity.update({
            where: { id },
            data: updateData,
            include: {
                account: {
                    include: {
                        companies: { where: { isPrimary: true }, take: 1 },
                        contacts: { where: { isPrimary: true }, take: 1 },
                    }
                },
                pipelineColumn: true
            }
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

export { router as pipelineRouter };
