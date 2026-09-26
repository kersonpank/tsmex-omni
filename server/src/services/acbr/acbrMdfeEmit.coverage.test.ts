import assert from 'node:assert/strict';
import { afterEach, beforeEach, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { emitMdfeViaAcbr } from './acbrMdfeEmit.js';

const original = {
    manifest: prisma.manifest.findUnique,
    legs: prisma.orderLeg.findMany,
    stops: prisma.manifestStop.findMany,
    fiscal: prisma.manifestFiscalDocument.findFirst,
};
const authorized = (digit: string) => ({ cteAccessKey: digit.repeat(44), cteProtocol: 'protocol', cteXml: '<authorized/>', cteXmlStorageKey: null });
const leg = (number: string, docs: unknown[]) => ({ order: { demand: { orderNumber: number }, freightCalculations: docs } });
beforeEach(() => {
    prisma.manifest.findUnique = (async () => ({
        hub: { person: {} }, link: { vehiclePlate: 'ABC1D23', vehicleChassi: '9BWZZZ377VT004251', vehicleRenavam: '12345678901', vehicleAxles: 3, rntrc: '123456789' },
    })) as any;
    prisma.manifestFiscalDocument.findFirst = (async () => { throw new Error('Não deve alcançar emissão fiscal com cobertura incompleta'); }) as any;
});
afterEach(() => {
    prisma.manifest.findUnique = original.manifest;
    prisma.orderLeg.findMany = original.legs;
    prisma.manifestStop.findMany = original.stops;
    prisma.manifestFiscalDocument.findFirst = original.fiscal;
});
it('não omite segundo pedido sem CT-e nem chama provedor', async () => {
    prisma.orderLeg.findMany = (async () => [leg('001', [authorized('1')]), leg('002', [])]) as any;
    const result = await emitMdfeViaAcbr('manifest', 'ref');
    assert.equal(result.ok, false);
    assert.match(result.error!, /002/);
});
it('chave sem XML e protocolo não comprova autorização', async () => {
    prisma.orderLeg.findMany = (async () => [leg('003', [{ cteAccessKey: '1'.repeat(44) }])]) as any;
    const result = await emitMdfeViaAcbr('manifest', 'ref');
    assert.equal(result.ok, false);
    assert.match(result.error!, /003/);
});
it('CT-e duplicado nas paradas não mascara pedido omitido', async () => {
    prisma.orderLeg.findMany = (async () => [leg('001', [authorized('1')]), leg('002', [authorized('2')])]) as any;
    prisma.manifestStop.findMany = (async () => [
        { id: 'stop-1', legs: [leg('001', [authorized('1')])] },
        { id: 'stop-2', legs: [leg('001', [authorized('1')])] },
    ]) as any;
    const result = await emitMdfeViaAcbr('manifest', 'ref');
    assert.equal(result.ok, false);
    assert.match(result.error!, /paradas/);
});
