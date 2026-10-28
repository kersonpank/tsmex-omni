import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import type { CteEmissionInput } from '../cteService.js';
import { createCteInputSnapshot } from '../fiscal/cteEmissionInputBuilder.js';
import { buildCteEmissionInputForJob } from './cteEmissionJobInput.js';

describe('dados preservados de uma tentativa fiscal', () => {
    it('consulta a tentativa com o ambiente e origem gravados, mesmo após alteração do pedido', async () => {
        const person = { legalName: 'Empresa', document: '12345678000190', city: 'São Paulo', state: 'SP' };
        const input: CteEmissionInput = {
            calc: { id: 'calc-1', originCity: 'Fortaleza, CE', destCity: 'Imperatriz, MA', cfop: '6352', cst: '40',
                tipoFrete: null, volumes: 1, weight: 10, effectiveWeight: 10, cubage: null, nfValue: 100,
                commodity: 'Carga', freightTotal: 50, breakdown: {}, icmsValue: null },
            order: { freightTerm: 'CIF', remetentePerson: person, destinatarioPerson: person, consignatarioPerson: null,
                expedidorPerson: null, invoicesRel: [], serviceStart: { city: 'Fortaleza', state: 'CE', ibgeCode: '2304400' },
                serviceEnd: { city: 'Imperatriz', state: 'MA', ibgeCode: '2105302' } },
            hub: { id: 'hub-1', name: 'Hub', code: 'FOR', rntrc: '12345678' },
            person, numero: 10, serie: 1, ambiente: 'HOMOLOGACAO',
        };
        const snapshot = createCteInputSnapshot(input);
        const originals = {
            calc: prisma.orderFreightCalculation.findUniqueOrThrow,
            hub: prisma.hub.findUniqueOrThrow,
            job: prisma.cteEmissionJob.findFirst,
        };
        prisma.orderFreightCalculation.findUniqueOrThrow = (async () => ({
            emissorId: 'hub-1', order: { origemPrestacao: 'Outro lugar, SP' },
            fiscalEmitter: { environment: 'PRODUCAO', crt: '3' },
        })) as any;
        prisma.hub.findUniqueOrThrow = (async () => ({ id: 'hub-1' })) as any;
        prisma.cteEmissionJob.findFirst = (async ({ where }: any) => {
            assert.deepEqual(where, { id: 'job-1', calcId: 'calc-1' });
            return { inputSnapshot: snapshot };
        }) as any;
        try {
            const result = await buildCteEmissionInputForJob('calc-1', 'job-1');
            assert.equal(result.input.order.serviceStart?.city, 'Fortaleza');
            assert.equal(result.input.calc.cfop, '6352');
            assert.equal(result.input.ambiente, 'HOMOLOGACAO');
            assert.equal(result.fiscalEmitterContext?.environment, 'HOMOLOGACAO');
        } finally {
            prisma.orderFreightCalculation.findUniqueOrThrow = originals.calc;
            prisma.hub.findUniqueOrThrow = originals.hub;
            prisma.cteEmissionJob.findFirst = originals.job;
        }
    });
});
