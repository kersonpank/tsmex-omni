import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';

const router = Router();

// ==================== PROVIDERS ====================

// GET /api/settings/llm/providers - List all providers
router.get('/providers', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const providers = await prisma.lLMProvider.findMany({
            include: {
                models: {
                    orderBy: { name: 'asc' }
                },
                apiKey: {
                    select: { id: true, keyPreview: true, label: true, active: true, monthlyLimit: true, monthlyUsage: true }
                },
                _count: { select: { models: true } }
            },
            orderBy: { name: 'asc' }
        });

        res.json({
            success: true,
            data: providers,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/settings/llm/providers - Create custom provider
router.post('/providers', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const schema = z.object({
            name: z.string().min(1),
            code: z.string().min(1).regex(/^[a-z0-9_-]+$/, 'Code must be lowercase with no spaces'),
            apiFormat: z.enum(['openai', 'gemini', 'anthropic']).default('openai'),
            baseUrl: z.string().url(),
            supportsTools: z.boolean().default(true),
        });

        const data = schema.parse(req.body);

        const provider = await prisma.lLMProvider.create({
            data: {
                ...data,
                isBuiltIn: false,  // Custom provider
            },
        });

        res.status(201).json({
            success: true,
            data: provider,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// ==================== MODELS ====================

// GET /api/settings/llm/models - List all models
router.get('/models', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { providerId, active, capability } = req.query;

        const models = await prisma.lLMModel.findMany({
            where: {
                ...(providerId ? { providerId: providerId as string } : {}),
                ...(active !== undefined ? { active: active === 'true' } : {}),
                ...(capability ? { capabilities: { has: capability as string } } : {}),
            },
            include: {
                provider: {
                    select: { name: true, code: true }
                }
            },
            orderBy: [{ isDefault: 'desc' }, { name: 'asc' }]
        });

        res.json({
            success: true,
            data: models,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/settings/llm/models/active - Get active model for capability
router.get('/models/active', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const capability = (req.query.capability as string) || 'chat';

        // Try to find default model with that capability
        let model = await prisma.lLMModel.findFirst({
            where: {
                active: true,
                isDefault: true,
                capabilities: { has: capability }
            },
            include: {
                provider: {
                    include: { apiKey: true }
                }
            }
        });

        // Fallback to any active model with that capability
        if (!model) {
            model = await prisma.lLMModel.findFirst({
                where: {
                    active: true,
                    capabilities: { has: capability }
                },
                include: {
                    provider: {
                        include: { apiKey: true }
                    }
                }
            });
        }

        if (!model) {
            throw new AppError(`No active model found for capability: ${capability}`, 404);
        }

        res.json({
            success: true,
            data: {
                modelId: model.modelId,
                providerCode: model.provider.code,
                apiKey: model.provider.apiKey?.apiKey,
                baseUrl: model.provider.baseUrl,
            },
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/settings/llm/models - Create model
router.post('/models', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const schema = z.object({
            providerId: z.string().uuid(),
            name: z.string().min(1),
            modelId: z.string().min(1),
            description: z.string().optional(),
            capabilities: z.array(z.string()).default(['chat']),
            contextWindow: z.number().int().positive().default(8192),
            maxOutput: z.number().int().positive().default(4096),
            inputPrice: z.number().optional(),
            outputPrice: z.number().optional(),
            isDefault: z.boolean().default(false),
            active: z.boolean().default(true),
        });

        const data = schema.parse(req.body);

        // If setting as default, unset other defaults with same capabilities
        if (data.isDefault) {
            for (const cap of data.capabilities) {
                await prisma.lLMModel.updateMany({
                    where: {
                        isDefault: true,
                        capabilities: { has: cap }
                    },
                    data: { isDefault: false }
                });
            }
        }

        const model = await prisma.lLMModel.create({
            data,
            include: { provider: true }
        });

        res.status(201).json({
            success: true,
            data: model,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// PATCH /api/settings/llm/models/:id - Update model
router.patch('/models/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const schema = z.object({
            name: z.string().min(1).optional(),
            description: z.string().optional(),
            capabilities: z.array(z.string()).optional(),
            contextWindow: z.number().int().positive().optional(),
            maxOutput: z.number().int().positive().optional(),
            inputPrice: z.number().optional(),
            outputPrice: z.number().optional(),
            active: z.boolean().optional(),
        });

        const data = schema.parse(req.body);

        const model = await prisma.lLMModel.update({
            where: { id: id },
            data,
            include: { provider: true }
        });

        res.json({
            success: true,
            data: model,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// DELETE /api/settings/llm/models/:id - Delete model
router.delete('/models/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        await prisma.lLMModel.delete({
            where: { id: id }
        });

        res.json({
            success: true,
            message: 'Model deleted',
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/settings/llm/models/:id/set-default - Set as default
router.post('/models/:id/set-default', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const model = await prisma.lLMModel.findUnique({
            where: { id: id }
        });

        if (!model) {
            throw new AppError('Model not found', 404);
        }

        // Unset other defaults with same capabilities
        for (const cap of model.capabilities) {
            await prisma.lLMModel.updateMany({
                where: {
                    isDefault: true,
                    capabilities: { has: cap },
                    id: { not: id }
                },
                data: { isDefault: false }
            });
        }

        const updated = await prisma.lLMModel.update({
            where: { id: id },
            data: { isDefault: true, active: true },
            include: { provider: true }
        });

        res.json({
            success: true,
            data: updated,
            message: 'Model set as default',
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/settings/llm/models/:id/test - Test model
router.post('/models/:id/test', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const model = await prisma.lLMModel.findUnique({
            where: { id: id },
            include: {
                provider: {
                    include: { apiKey: true }
                }
            }
        });

        if (!model) {
            throw new AppError('Model not found', 404);
        }

        if (!model.provider.apiKey?.apiKey) {
            throw new AppError('No API key configured for this provider', 400);
        }

        // Import and use the LLM service
        const { testModelConnection } = await import('../services/llmService.js');
        const result = await testModelConnection(
            {
                apiFormat: model.provider.apiFormat,
                baseUrl: model.provider.baseUrl,
                apiKey: model.provider.apiKey.apiKey,
            },
            model.modelId
        );

        res.json({
            success: true,
            data: {
                working: result.success,
                latencyMs: result.latencyMs,
                response: result.response,
                error: result.error,
            },
        });
    } catch (error) {
        next(error);
    }
});

// ==================== API KEYS ====================

// POST /api/settings/llm/api-keys - Save API key
router.post('/api-keys', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const schema = z.object({
            providerId: z.string().uuid('Provider ID must be a valid UUID'),
            apiKey: z.string().min(1, 'API key cannot be empty'),
            label: z.string().optional(),
        });

        const data = schema.parse(req.body);

        // Verify provider exists
        const provider = await prisma.lLMProvider.findUnique({
            where: { id: data.providerId }
        });

        if (!provider) {
            return next(new AppError('Provider not found', 404));
        }

        // Create preview (last 4 chars)
        const keyPreview = '...' + data.apiKey.slice(-4);

        // Upsert (update or create)
        const apiKey = await prisma.lLMApiKey.upsert({
            where: { providerId: data.providerId },
            update: {
                apiKey: data.apiKey,
                keyPreview,
                label: data.label,
                active: true,
            },
            create: {
                providerId: data.providerId,
                apiKey: data.apiKey,
                keyPreview,
                label: data.label,
            },
        });

        res.json({
            success: true,
            data: {
                id: apiKey.id,
                keyPreview: apiKey.keyPreview,
                label: apiKey.label,
            },
            message: 'API key saved',
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// DELETE /api/settings/llm/api-keys/:providerId - Delete API key
router.delete('/api-keys/:providerId', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const providerId = req.params.providerId as string;

        await prisma.lLMApiKey.delete({
            where: { providerId }
        });

        res.json({
            success: true,
            message: 'API key deleted',
        });
    } catch (error) {
        next(error);
    }
});

// ==================== CHAT LLM CONFIGURATION ====================

// GET /api/settings/llm/chat-config - Get chat LLM configuration
router.get('/chat-config', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        let config = await prisma.chatLLMConfig.findFirst({
            where: { active: true },
            include: {
                fixedModel: {
                    include: {
                        provider: {
                            select: { name: true, code: true }
                        }
                    }
                },
                rotationModels: {
                    where: { active: true },
                    include: {
                        model: {
                            include: {
                                provider: {
                                    select: { name: true, code: true }
                                }
                            }
                        }
                    },
                    orderBy: { order: 'asc' }
                }
            }
        });

        // If no config exists, create default
        if (!config) {
            // Find first active chat-capable model with API key
            const defaultModel = await prisma.lLMModel.findFirst({
                where: {
                    active: true,
                    capabilities: { has: 'chat' },
                    provider: {
                        active: true,
                        apiKey: {
                            active: true,
                            apiKey: { not: '' }
                        }
                    }
                },
                include: {
                    provider: {
                        select: { name: true, code: true }
                    }
                }
            });

            if (defaultModel) {
                config = await prisma.chatLLMConfig.create({
                    data: {
                        selectionMode: 'FIXED',
                        fixedModelId: defaultModel.id,
                        active: true
                    },
                    include: {
                        fixedModel: {
                            include: {
                                provider: {
                                    select: { name: true, code: true }
                                }
                            }
                        },
                        rotationModels: {
                            include: {
                                model: {
                                    include: {
                                        provider: {
                                            select: { name: true, code: true }
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }

        res.json({
            success: true,
            data: config,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/settings/llm/chat-config - Create or update chat LLM configuration
router.post('/chat-config', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const schema = z.object({
            selectionMode: z.enum(['FIXED', 'ROTATION', 'LOAD_BALANCE']).default('FIXED'),
            fixedModelId: z.string().uuid().optional(),
            active: z.boolean().default(true),
        });

        const data = schema.parse(req.body);

        // Validate fixed model if provided
        if (data.fixedModelId) {
            const model = await prisma.lLMModel.findUnique({
                where: { id: data.fixedModelId },
                include: {
                    provider: {
                        include: { apiKey: true }
                    }
                }
            });

            if (!model) {
                throw new AppError('Model not found', 404);
            }

            if (!model.active || !model.provider.active) {
                throw new AppError('Model or provider is not active', 400);
            }

            if (!model.capabilities.includes('chat')) {
                throw new AppError('Model does not have chat capability', 400);
            }

            if (!model.provider.apiKey?.active || !model.provider.apiKey?.apiKey) {
                throw new AppError('Model provider does not have a valid API key', 400);
            }
        }

        // Deactivate existing configs
        await prisma.chatLLMConfig.updateMany({
            where: { active: true },
            data: { active: false }
        });

        // Find existing config to update, or create new
        let config = await prisma.chatLLMConfig.findFirst({
            where: { active: false },
            orderBy: { updatedAt: 'desc' }
        });

        const configData = {
            selectionMode: data.selectionMode,
            fixedModelId: data.selectionMode === 'FIXED' ? data.fixedModelId : null,
            active: data.active,
        };

        if (config) {
            // Update existing
            config = await prisma.chatLLMConfig.update({
                where: { id: config.id },
                data: configData,
                include: {
                    fixedModel: {
                        include: {
                            provider: {
                                select: { name: true, code: true }
                            }
                        }
                    },
                    rotationModels: {
                        include: {
                            model: {
                                include: {
                                    provider: {
                                        select: { name: true, code: true }
                                    }
                                }
                            }
                        }
                    }
                }
            });
        } else {
            // Create new
            config = await prisma.chatLLMConfig.create({
                data: configData,
                include: {
                    fixedModel: {
                        include: {
                            provider: {
                                select: { name: true, code: true }
                            }
                        }
                    },
                    rotationModels: {
                        include: {
                            model: {
                                include: {
                                    provider: {
                                        select: { name: true, code: true }
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }

        res.json({
            success: true,
            data: config,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// POST /api/settings/llm/chat-config/rotation-models - Add model to rotation
router.post('/chat-config/rotation-models', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const schema = z.object({
            modelId: z.string().uuid(),
            weight: z.number().int().min(1).max(10).default(1),
            order: z.number().int().default(0),
        });

        const data = schema.parse(req.body);

        // Get or create config (only one active config should exist)
        let config = await prisma.chatLLMConfig.findFirst({
            where: { active: true }
        });

        if (!config) {
            // Deactivate any existing configs first
            await prisma.chatLLMConfig.updateMany({
                where: { active: true },
                data: { active: false }
            });
            
            config = await prisma.chatLLMConfig.create({
                data: {
                    selectionMode: 'ROTATION',
                    active: true
                }
            });
        }

        // Validate model
        const model = await prisma.lLMModel.findUnique({
            where: { id: data.modelId },
            include: {
                provider: {
                    include: { apiKey: true }
                }
            }
        });

        if (!model) {
            throw new AppError('Model not found', 404);
        }

        if (!model.active || !model.provider.active) {
            throw new AppError('Model or provider is not active', 400);
        }

        if (!model.capabilities.includes('chat')) {
            throw new AppError('Model does not have chat capability', 400);
        }

        if (!model.provider.apiKey?.active || !model.provider.apiKey?.apiKey) {
            throw new AppError('Model provider does not have a valid API key', 400);
        }

        // Add to rotation
        const rotation = await prisma.chatLLMRotation.upsert({
            where: {
                configId_modelId: {
                    configId: config.id,
                    modelId: data.modelId
                }
            },
            update: {
                weight: data.weight,
                order: data.order,
                active: true,
            },
            create: {
                configId: config.id,
                modelId: data.modelId,
                weight: data.weight,
                order: data.order,
                active: true,
            },
            include: {
                model: {
                    include: {
                        provider: {
                            select: { name: true, code: true }
                        }
                    }
                }
            }
        });

        res.json({
            success: true,
            data: rotation,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

// DELETE /api/settings/llm/chat-config/rotation-models/:id - Remove model from rotation
router.delete('/chat-config/rotation-models/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        await prisma.chatLLMRotation.delete({
            where: { id }
        });

        res.json({
            success: true,
            message: 'Model removed from rotation',
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/settings/llm/chat-config/rotation-models/:id - Update rotation model
router.patch('/chat-config/rotation-models/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        const schema = z.object({
            weight: z.number().int().min(1).max(10).optional(),
            order: z.number().int().optional(),
            active: z.boolean().optional(),
        });

        const data = schema.parse(req.body);

        const rotation = await prisma.chatLLMRotation.update({
            where: { id },
            data,
            include: {
                model: {
                    include: {
                        provider: {
                            select: { name: true, code: true }
                        }
                    }
                }
            }
        });

        res.json({
            success: true,
            data: rotation,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(new AppError(error.errors[0].message, 400));
        }
        next(error);
    }
});

export { router as settingsRouter };
