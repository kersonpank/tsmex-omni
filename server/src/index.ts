import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import helmet from 'helmet';
import { authRouter } from './routes/auth.js';
import { vehicleTypesRouter } from './routes/vehicleTypes.js';
import { vehicleUnitsRouter } from './routes/vehicleUnits.js';
import { hubsRouter } from './routes/hubs.js';
import { clientsRouter } from './routes/clients.js';
import { linksRouter } from './routes/links.js';
import { demandsRouter } from './routes/demands.js';
import { manifestsRouter } from './routes/manifests.js';
import { pricingRouter } from './routes/pricing.js';
import { settingsRouter } from './routes/settings.js';
import { opportunitiesRouter } from './routes/opportunities.js';
import { chatRouter } from './routes/chat.js';
import { accountsRouter } from './routes/accounts.js';
import { locationsRouter } from './routes/locations.js';
import { ordersRouter } from './routes/orders.js';
import { invoicesRouter } from './routes/invoices.js';
import { payablesRouter } from './routes/payables.js';
import { costAgreementsRouter } from './routes/costAgreements.js';
import { pipelineRouter } from './routes/pipeline.js';
import { personsRouter } from './routes/persons.js';
import { usersRouter } from './routes/users.js';
import { uploadRouter } from './routes/upload.js';
import { nfSpeciesRouter } from './routes/nfSpecies.js';
import { nfeRouter } from './routes/nfe.js';
import { dashboardRouter } from './routes/dashboard.js';
import { brandingRouter } from './routes/branding.js';
import { fiscalEmittersRouter } from './routes/fiscalEmitters.js';
import { fiscalDistribuicaoRouter } from './routes/fiscalDistribuicao.js';
import { nfeDistribuicaoTriagemRouter } from './routes/nfeDistribuicaoTriagem.js';
import { intakeDemandsRouter } from './routes/intakeDemands.js';
import { hubCargoRouter } from './routes/hubCargo.js';
import { systemAlertsRouter } from './routes/systemAlerts.js';
import { errorHandler } from './middleware/errorHandler.js';
import { getApiHealth } from './services/health.js';
import prisma from './lib/prisma.js';
import { assertProductionEnv } from './lib/envValidation.js';
import { installProcessErrorHandlers } from './lib/processHandlers.js';
import { createJsonBodyParser } from './middleware/bodyLimits.js';
import { applyRateLimits } from './middleware/rateLimit.js';

dotenv.config();

installProcessErrorHandlers('api');
try {
    assertProductionEnv('api');
} catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
}

const app = express();
// A API fica atrás de Traefik/nginx: confia em 1 salto para obter o IP real do cliente (rate limit).
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST ?? '0.0.0.0';

const corsOrigins = (process.env.CORS_ORIGIN?.trim() || 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

// Middleware
// API JSON pura: sem CSP de página; CORP cross-origin porque o front (outra origem) consome as respostas.
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) {
            callback(null, true);
            return;
        }
        if (corsOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(null, false);
    },
    credentials: true,
}));
app.use(createJsonBodyParser());
app.use(morgan('dev'));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/api/health', async (_req, res) => {
    const health = await getApiHealth();
    res.status(health.status === 'ok' ? 200 : 503).json(health);
});

// Routes
applyRateLimits(app);
app.use('/api/auth', authRouter);
app.use('/api/vehicle-types', vehicleTypesRouter);
app.use('/api/vehicle-units', vehicleUnitsRouter);
app.use('/api/hubs', hubsRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/links', linksRouter);
app.use('/api/demands', demandsRouter);
app.use('/api/manifests', manifestsRouter);
app.use('/api/pricing', pricingRouter);
app.use('/api/settings/llm', settingsRouter);
app.use('/api/settings/branding', brandingRouter);
app.use('/api/fiscal-emitters', fiscalEmittersRouter);
app.use('/api/fiscal', fiscalDistribuicaoRouter);
app.use('/api/fiscal/distribuicao-nfe/triagem', nfeDistribuicaoTriagemRouter);
app.use('/api/system-alerts', systemAlertsRouter);
app.use('/api/intake', intakeDemandsRouter);
app.use('/api/hub/cargo', hubCargoRouter);
app.use('/api/opportunities', opportunitiesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/payables', payablesRouter);
app.use('/api/cost-agreements', costAgreementsRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/persons', personsRouter);
app.use('/api/users', usersRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/nf-species', nfSpeciesRouter);
app.use('/api/nfe', nfeRouter);
app.use('/api/dashboard', dashboardRouter);

// Error handler
app.use(errorHandler);

(async () => {
    if (process.env.S3_ENDPOINT || process.env.MINIO_ENDPOINT) {
        try {
            const { ensureBucketExists } = await import('./lib/objectStorage.js');
            await ensureBucketExists();
            console.log('✅ S3/MinIO bucket pronto');
        } catch (err) {
            console.warn('⚠️  S3/MinIO bucket check falhou (uploads indisponíveis):', err instanceof Error ? err.message : err);
        }
    }

    const server = app.listen(Number(PORT), HOST, () => {
        console.log(`🚀 TSM EX API listening on http://${HOST}:${PORT}`);
        console.log(`📊 Health check: http://${HOST}:${PORT}/health`);
    });

    let shuttingDown = false;
    const shutdown = (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`${signal} recebido: encerrando API...`);
        // Teto de segurança: o orquestrador mata o container após o grace period de qualquer forma.
        const force = setTimeout(() => process.exit(1), 25_000);
        force.unref();
        server.close(async () => {
            try {
                await prisma.$disconnect();
            } finally {
                process.exit(0);
            }
        });
        server.closeIdleConnections?.();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
})();

export default app;
