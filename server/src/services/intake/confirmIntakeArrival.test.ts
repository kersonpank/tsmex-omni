import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import prisma from '../../lib/prisma.js';
import { confirmIntakeArrival } from './confirmIntakeArrival.js';
import { AppError } from '../../middleware/errorHandler.js';

describe('confirmIntakeArrival', () => {
    const origFind = prisma.demand.findUnique.bind(prisma.demand);

    afterEach(() => {
        prisma.demand.findUnique = origFind;
    });

    it('Hub de outro CD → 403', async () => {
        prisma.demand.findUnique = (async () => ({
            id: 'd1',
            status: 'AWAITING_ARRIVAL',
            sourceType: 'MANUAL_HUB',
            clientId: 'c1',
            origin: 'A',
            destination: 'B',
            nfNumber: 'NF1',
            manifestId: null,
            client: { id: 'c1', personId: 'p-remet', companyName: 'X' },
            order: null,
            expectedHubId: 'hub-1',
        })) as unknown as typeof prisma.demand.findUnique;

        await assert.rejects(
            () =>
                confirmIntakeArrival({
                    demandId: 'd1',
                    actingRoles: ['HUB'],
                    actingHubId: 'hub-2',
                    destinatarioPersonId: 'p-dest',
                }),
            (err: unknown) => err instanceof AppError && err.statusCode === 403,
        );
    });

    it('Cliente sem personId e sem remetente no body → 400', async () => {
        prisma.demand.findUnique = (async () => ({
            id: 'd1',
            status: 'AWAITING_ARRIVAL',
            sourceType: 'MANUAL_HUB',
            clientId: 'c1',
            origin: 'A',
            destination: 'B',
            nfNumber: 'NF1',
            manifestId: null,
            client: { id: 'c1', personId: null, companyName: 'X' },
            order: null,
            expectedHubId: 'hub-1',
        })) as unknown as typeof prisma.demand.findUnique;

        await assert.rejects(
            () =>
                confirmIntakeArrival({
                    demandId: 'd1',
                    actingRoles: ['HUB'],
                    actingHubId: 'hub-1',
                    destinatarioPersonId: 'p-dest',
                }),
            (err: unknown) => err instanceof AppError && err.statusCode === 400,
        );
    });
});
