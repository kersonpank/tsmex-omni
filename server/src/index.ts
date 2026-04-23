import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import { authRouter } from './routes/auth.js';
import { vehicleTypesRouter } from './routes/vehicleTypes.js';
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
import { pipelineRouter } from './routes/pipeline.js';
import { personsRouter } from './routes/persons.js';
import { usersRouter } from './routes/users.js';
import { uploadRouter } from './routes/upload.js';
import { nfSpeciesRouter } from './routes/nfSpecies.js';
import { nfeRouter } from './routes/nfe.js';
import { errorHandler } from './middleware/errorHandler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST ?? '0.0.0.0';

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());
app.use(morgan('dev'));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/vehicle-types', vehicleTypesRouter);
app.use('/api/hubs', hubsRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/links', linksRouter);
app.use('/api/demands', demandsRouter);
app.use('/api/manifests', manifestsRouter);
app.use('/api/pricing', pricingRouter);
app.use('/api/settings/llm', settingsRouter);
app.use('/api/opportunities', opportunitiesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/persons', personsRouter);
app.use('/api/users', usersRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/nf-species', nfSpeciesRouter);
app.use('/api/nfe', nfeRouter);

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

    app.listen(Number(PORT), HOST, () => {
        console.log(`🚀 TSM EX API listening on http://${HOST}:${PORT}`);
        console.log(`📊 Health check: http://${HOST}:${PORT}/health`);
    });
})();

export default app;
