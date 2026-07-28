import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { createRedisConnection } from '../lib/redis.js';

const router = Router();
const redis = createRedisConnection();

/** Demandas visíveis para um operador de hub (alinhado a `demands` route). */
function hubDemandFilter(hubId: string): Prisma.DemandWhereInput {
  return {
    OR: [
      { order: { legs: { some: { manifest: { hubId } } } } },
      { order: { currentHubId: hubId } }
    ],
  };
}

// GET /api/dashboard/operations-summary
router.get(
  '/operations-summary',
  authenticate,
  authorize('ADMIN', 'HUB'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const isHub = req.user!.roles.includes('HUB');
      const hubId = req.user!.hubId;
      if (isHub && !hubId) {
        return res.status(403).json({ success: false, error: 'Hub user has no hub assigned' });
      }

      const cacheKey = `dashboard:ops-summary:${hubId ?? 'admin'}`;
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));
      } catch { /* cache miss — fall through to DB */ }

      const d7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const generatedAt = new Date().toISOString();

      const baseDemand: Prisma.DemandWhereInput = isHub ? hubDemandFilter(hubId!) : {};

      const [
        aguardandoCotacao,
        emTransito,
        noHub,
        riscoA,
        aConsolidar,
        coletasFila,
        coletasEmRota,
        pedidosNoCd,
        pedidosEmTransito,
        pedidosAging7d,
        totalClients,
      ] = await prisma.$transaction([
        prisma.demand.count({ where: { ...baseDemand, status: 'PENDING' } }),
        prisma.order.count({ where: { demand: baseDemand, status: 'IN_TRANSIT' } }),
        prisma.order.count({ where: { demand: baseDemand, status: 'AT_HUB' } }),
        prisma.demand.count({ where: { ...baseDemand, riskClass: 'A' } }),
        prisma.demand.count({
          where: {
            ...baseDemand,
            status: { in: ['PENDING', 'QUOTED', 'APPROVED'] },
          },
        }),
        prisma.demand.count({
          where: {
            ...baseDemand,
            intentType: 'COLLECT',
            status: 'APPROVED',
          },
        }),
        prisma.order.count({
          where: {
            demand: {
              ...baseDemand,
              intentType: 'COLLECT',
            },
            status: 'IN_TRANSIT',
          },
        }),
        prisma.order.count({
          where: isHub
            ? { currentHubId: hubId, status: 'AT_HUB' }
            : { status: 'AT_HUB' },
        }),
        prisma.order.count({
          where: isHub
            ? { currentHubId: hubId, status: 'IN_TRANSIT' }
            : { status: 'IN_TRANSIT' },
        }),
        prisma.order.count({
          where: {
            ...(isHub
              ? { currentHubId: hubId, status: 'AT_HUB' }
              : { status: 'AT_HUB' }),
            enteredAtHubAt: { lt: d7 },
          },
        }),
        prisma.client.count(),
      ]);

      const oportunidadesColetaCrm = isHub
        ? 0
        : await prisma.opportunity.count({ where: { stage: 'COLLECTION_REQUESTED' } });

      const clientWhere7d: Prisma.ClientWhereInput = isHub
        ? { createdAt: { gte: d7 }, demands: { some: hubDemandFilter(hubId!) } }
        : { createdAt: { gte: d7 } };
      const clientWhere30d: Prisma.ClientWhereInput = isHub
        ? { createdAt: { gte: d30 }, demands: { some: hubDemandFilter(hubId!) } }
        : { createdAt: { gte: d30 } };

      const [novos7d, novos30d] = await Promise.all([
        prisma.client.count({ where: clientWhere7d }),
        prisma.client.count({ where: clientWhere30d }),
      ]);

      let estoquePorHub: { hubId: string; name: string; code: string; count: number }[] = [];
      if (!isHub) {
        const grouped = await prisma.order.groupBy({
          by: ['currentHubId'],
          where: { status: 'AT_HUB', currentHubId: { not: null } },
          _count: { _all: true },
        });
        const hubIds = grouped.map((g) => g.currentHubId).filter((id): id is string => id != null);
        if (hubIds.length > 0) {
          const hubs = await prisma.hub.findMany({
            where: { id: { in: hubIds } },
            select: { id: true, name: true, code: true },
          });
          const hubMap = new Map(hubs.map((h) => [h.id, h]));
          estoquePorHub = grouped
            .map((g) => {
              const h = g.currentHubId ? hubMap.get(g.currentHubId) : undefined;
              return {
                hubId: g.currentHubId!,
                name: h?.name ?? g.currentHubId!,
                code: h?.code ?? '',
                count: g._count._all,
              };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 6);
        }
      }

      const result = {
        success: true,
        data: {
          generatedAt,
          scope: isHub ? 'HUB' : 'ADMIN',
          cenario: {
            aguardandoCotacao,
            emTransito,
            noHub,
            riscoA,
            aConsolidar,
          },
          coletas: {
            fila: coletasFila,
            emRota: coletasEmRota,
            oportunidadesColetaCrm,
          },
          estoque: {
            pedidosNoCd,
            pedidosEmTransito,
            agingMais7d: pedidosAging7d,
            porHub: estoquePorHub,
          },
          clientes: {
            total: totalClients,
            novos7d,
            novos30d,
            nota: isHub
              ? 'Novos = cadastros no período com demanda vinculada a este depósito.'
              : 'Novos = cadastros de clientes (CNPJ) no período.',
          },
        },
      };

      try { await redis.set(cacheKey, JSON.stringify(result), 'EX', 30); } catch { /* non-fatal */ }

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export { router as dashboardRouter };
