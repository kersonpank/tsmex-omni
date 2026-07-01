import { Router, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import axios from 'axios';
import { resolveIbgeCode } from '../services/acbr/acbrIbge.js';

const router = Router();

// ==================== STATES ====================

// GET /api/locations/states - List all states
router.get('/states', async (req, res: Response, next: NextFunction) => {
    try {
        const states = await prisma.state.findMany({
            orderBy: { name: 'asc' },
            select: {
                id: true,
                code: true,
                name: true,
                ibgeCode: true,
            }
        });

        res.json({
            success: true,
            data: states,
        });
    } catch (error) {
        next(error);
    }
});

// ==================== CITIES ====================

// GET /api/locations/cities - List cities (optionally filtered by state)
router.get('/cities', async (req, res: Response, next: NextFunction) => {
    try {
        const { state, q } = req.query;

        let where: any = {};
        
        if (state) {
            const stateRecord = await prisma.state.findUnique({
                where: { code: state as string }
            });
            if (stateRecord) {
                where.stateId = stateRecord.id;
            }
        }

        if (q) {
            where.name = {
                contains: q as string,
                mode: 'insensitive' as const,
            };
        }

        const cities = await prisma.city.findMany({
            where,
            include: {
                state: {
                    select: {
                        code: true,
                        name: true,
                    }
                }
            },
            orderBy: { name: 'asc' },
            // Removed limit to return all cities for a state
        });

        res.json({
            success: true,
            data: cities,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/locations/cities/:id - Get city by ID
router.get('/cities/:id', async (req, res: Response, next: NextFunction) => {
    try {
        const city = await prisma.city.findUnique({
            where: { id: req.params.id },
            include: {
                state: true,
            }
        });

        if (!city) {
            throw new AppError('City not found', 404);
        }

        res.json({
            success: true,
            data: city,
        });
    } catch (error) {
        next(error);
    }
});

// ==================== CEP ====================

// GET /api/locations/cep/:cep - Search address by CEP (using ViaCEP API)
router.get('/cep/:cep', async (req, res: Response, next: NextFunction) => {
    try {
        const cep = req.params.cep.replace(/\D/g, '');

        if (cep.length !== 8) {
            throw new AppError('CEP must have 8 digits', 400);
        }

        // First, try to find in database
        const cepRecord = await prisma.cEP.findUnique({
            where: { cep },
            include: {
                city: {
                    include: {
                        state: true,
                    }
                },
                state: true,
            }
        });

        if (cepRecord) {
            return res.json({
                success: true,
                data: {
                    cep: cepRecord.cep,
                    logradouro: cepRecord.logradouro,
                    bairro: cepRecord.bairro,
                    cidade: cepRecord.city?.name,
                    uf: cepRecord.state?.code,
                    state: cepRecord.state,
                    city: cepRecord.city,
                },
                source: 'database',
            });
        }

        // If not in database, consult ViaCEP API
        try {
            const viaCepResponse = await axios.get(`https://viacep.com.br/ws/${cep}/json/`, {
                timeout: 5000,
            });

            if (viaCepResponse.data.erro) {
                throw new AppError('CEP not found', 404);
            }

            const data = viaCepResponse.data;

            // Try to find state and city in database
            let stateRecord = null;
            let cityRecord = null;

            if (data.uf) {
                stateRecord = await prisma.state.findUnique({
                    where: { code: data.uf },
                });
            }

            if (data.localidade && stateRecord) {
                cityRecord = await prisma.city.findFirst({
                    where: {
                        name: data.localidade,
                        stateId: stateRecord.id,
                    }
                });

                if (!cityRecord) {
                    const resolved = await resolveIbgeCode(data.localidade, stateRecord.code);
                    if (resolved) {
                        cityRecord = await prisma.city.findUnique({
                            where: { ibgeCode: resolved.ibgeCode }
                        });
                    }
                }
            }

            // Save to database for future queries
            try {
                await prisma.cEP.create({
                    data: {
                        cep,
                        logradouro: data.logradouro || null,
                        bairro: data.bairro || null,
                        cityId: cityRecord?.id || null,
                        stateId: stateRecord?.id || null,
                    }
                });
            } catch (err) {
                // Ignore if already exists or other error
                console.error('Error saving CEP to database:', err);
            }

            res.json({
                success: true,
                data: {
                    cep: data.cep?.replace(/\D/g, ''),
                    logradouro: data.logradouro,
                    bairro: data.bairro,
                    cidade: data.localidade,
                    uf: data.uf,
                    state: stateRecord,
                    city: cityRecord,
                },
                source: 'viacep',
            });
        } catch (apiError: any) {
            if (apiError.response?.status === 404 || apiError.message === 'CEP not found') {
                throw new AppError('CEP not found', 404);
            }
            throw new AppError('Error consulting CEP service', 500);
        }
    } catch (error) {
        next(error);
    }
});

// ==================== SEARCH ====================

// Normalize text: remove accents and convert to lowercase
function normalizeText(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

// GET /api/locations/search - Search cities by name
router.get('/search', async (req, res: Response, next: NextFunction) => {
    try {
        const { q, state } = req.query;

        if (!q || (q as string).length < 2) {
            return res.json({
                success: true,
                data: [],
            });
        }

        // Normalize query for accent-insensitive search
        const normalizedQuery = normalizeText(q as string);

        // Build where clause - search with original query (Prisma will do case-insensitive)
        let where: any = {
            name: {
                contains: q as string,
                mode: 'insensitive' as const,
            }
        };

        if (state) {
            const stateRecord = await prisma.state.findUnique({
                where: { code: state as string }
            });
            if (stateRecord) {
                where.stateId = stateRecord.id;
            }
        }

        // Fetch more results than needed to filter by normalized name
        const cities = await prisma.city.findMany({
            where,
            include: {
                state: {
                    select: {
                        code: true,
                        name: true,
                    }
                }
            },
            orderBy: { name: 'asc' },
            take: 200, // Fetch more to filter (increased for better accent-insensitive matching)
        });

        // Filter by normalized name (accent-insensitive)
        const filtered = cities.filter(city => {
            const normalizedName = normalizeText(city.name);
            return normalizedName.includes(normalizedQuery);
        }).slice(0, 10); // Return max 10 results

        res.json({
            success: true,
            data: filtered,
        });
    } catch (error) {
        next(error);
    }
});

export { router as locationsRouter };
