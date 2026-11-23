import { Router, Response, NextFunction } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { resolveReportPeriod, type ReportPeriod } from '../services/reports/common.js';
import { loadTripsReport } from '../services/reports/tripsReport.js';
import { loadOrdersReport } from '../services/reports/ordersReport.js';
import { loadFinanceReport } from '../services/reports/financeReport.js';
import { loadExceptionsReport } from '../services/reports/exceptionsReport.js';
import { loadAutonomyReport } from '../services/reports/autonomyReport.js';

/**
 * Relatórios de gestão: SOMENTE LEITURA, só ADMIN. Query `from`/`to` (ISO) opcionais;
 * padrão últimos 30 dias, máximo 366. Período inválido responde 400 com mensagem clara.
 */
export const reportsRouter = Router();

function report<T>(load: (period: ReportPeriod) => Promise<T>) {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const period = resolveReportPeriod(req.query);
            res.json({ success: true, data: await load(period) });
        } catch (error) {
            next(error);
        }
    };
}

reportsRouter.get('/trips', authenticate, authorize('ADMIN'), report((p) => loadTripsReport(p)));
reportsRouter.get('/orders', authenticate, authorize('ADMIN'), report((p) => loadOrdersReport(p)));
reportsRouter.get('/finance', authenticate, authorize('ADMIN'), report((p) => loadFinanceReport(p)));
reportsRouter.get('/exceptions', authenticate, authorize('ADMIN'), report((p) => loadExceptionsReport(p)));
reportsRouter.get('/autonomy', authenticate, authorize('ADMIN'), report((p) => loadAutonomyReport(p)));

export default reportsRouter;
