import { Router, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { normalizeCityName } from '../services/selectedCity.js';
import { lookupCep } from '../services/cepLookup.js';

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

// GET /api/locations/cep/:cep - Search address by CEP (ViaCEP + BrasilAPI)
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

        if (cepRecord?.city && cepRecord.state && cepRecord.city.stateId === cepRecord.state.id) {
            return res.json({
                success: true,
                data: {
                    cep: cepRecord.cep,
                    logradouro: cepRecord.logradouro,
                    bairro: cepRecord.bairro,
                    cidade: cepRecord.city?.name,
                    uf: cepRecord.state.code,
                    cityIbgeCode: cepRecord.city.ibgeCode,
                    state: cepRecord.state,
                    city: cepRecord.city,
                },
                source: 'database',
            });
        }

        // Fora do cache: ViaCEP com fallback BrasilAPI (cobre CEP geral de município).
        // O IBGE oficial vem do provedor — nunca se busca cidade por nome.
        const found = await lookupCep(cep);
        const stateRecord = await prisma.state.findUnique({ where: { code: found.uf } });
        const cityRecord = stateRecord ? await prisma.city.findUnique({ where: { ibgeCode: found.ibge } }) : null;
        if (!stateRecord || !cityRecord || cityRecord.stateId !== stateRecord.id) {
            throw new AppError('Município do CEP indisponível no cadastro IBGE. Tente novamente ou selecione a cidade na busca.', 422);
        }

        try {
            await prisma.cEP.upsert({
                where: { cep },
                update: { logradouro: found.logradouro || null, bairro: found.bairro || null, cityId: cityRecord.id, stateId: stateRecord.id },
                create: { cep, logradouro: found.logradouro || null, bairro: found.bairro || null, cityId: cityRecord.id, stateId: stateRecord.id },
            });
        } catch (err) {
            console.error('Error saving CEP to database:', err);
        }

        res.json({
            success: true,
            data: {
                cep,
                logradouro: found.logradouro,
                bairro: found.bairro,
                cidade: cityRecord.name,
                cityIbgeCode: cityRecord.ibgeCode,
                uf: found.uf,
                state: stateRecord,
                city: cityRecord,
            },
            source: found.source,
        });
    } catch (error) {
        next(error);
    }
});

// ==================== SEARCH ====================

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

        const query = String(q).trim();
        const suffix = query.match(/^(.*?)[,\-]\s*([A-Za-z]{2})$/);
        const searchName = normalizeCityName(suffix ? suffix[1] : query);
        const searchState = String(state || suffix?.[2] || '').toUpperCase();
        // Filtering before normalization excluded São Paulo for "sao paulo".
        // The national catalog has ~5,600 rows; filter accents before limiting.
        const cities = await prisma.city.findMany({
            where: searchState ? { state: { code: searchState } } : {},
            select: { id: true, name: true, ibgeCode: true, state: { select: { code: true, name: true } } },
            orderBy: { name: 'asc' },
        });
        const rank = (name: string) => name === searchName ? 0 : name.startsWith(searchName) ? 1 : 2;
        const filtered = cities.filter(city => normalizeCityName(city.name).includes(searchName))
            .sort((a, b) => rank(normalizeCityName(a.name)) - rank(normalizeCityName(b.name)) || a.name.localeCompare(b.name, 'pt-BR'))
            .slice(0, 10);

        res.json({
            success: true,
            data: filtered,
        });
    } catch (error) {
        next(error);
    }
});

export { router as locationsRouter };
