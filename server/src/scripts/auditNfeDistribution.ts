import prisma from '../lib/prisma.js';
import { listObjectKeys, objectExists } from '../lib/objectStorage.js';
import { getCargoDataFromDistribuicaoDocument } from '../services/fiscal/nfeDistribuicaoCargoData.js';
import { resolveLocalNfeCargo } from '../services/intake/resolveLocalNfeCargo.js';

async function main() {
const repair = process.argv.includes('--repair');
const report = { demandsWithoutCargo: [] as string[], documentsWithoutXml: [] as string[], missingObjects: [] as string[], invalidXml: [] as string[], orphanObjects: [] as string[], repaired: [] as string[], storageError: null as string | null };

const demands = await prisma.demand.findMany({ where: { sourceType: 'DFE_ACBR' }, select: { id: true, rawInputData: true } });
for (const demand of demands) {
    const raw = demand.rawInputData as Record<string, unknown> | null;
    if (!raw?.nfeXmlData) {
        report.demandsWithoutCargo.push(demand.id);
        if (repair) {
            const result = await resolveLocalNfeCargo(demand.id);
            if (result.status === 'available') report.repaired.push(demand.id);
        }
    }
}

const documents = await prisma.nfeDistribuicaoDocumento.findMany({ select: { id: true, accessKey: true, tipo: true, status: true, xmlStorageKey: true } });
const referenced = new Set<string>();
for (const document of documents) {
    if (!document.xmlStorageKey) {
        if (document.status === 'CONVERTED') report.documentsWithoutXml.push(document.id);
        continue;
    }
    referenced.add(document.xmlStorageKey);
    try {
        if (!await objectExists(document.xmlStorageKey)) { report.missingObjects.push(document.id); continue; }
    } catch (error) {
        report.storageError = error instanceof Error ? error.message : String(error);
        break;
    }
    try {
        const cargo = await getCargoDataFromDistribuicaoDocument(document);
        if (!cargo || cargo.chave.replace(/\D/g, '') !== document.accessKey) report.invalidXml.push(document.id);
    } catch { report.invalidXml.push(document.id); }
}
if (!report.storageError) {
    try {
        for (const key of await listObjectKeys('nfe-distribuicao/')) if (!referenced.has(key)) report.orphanObjects.push(key);
    } catch (error) { report.storageError = error instanceof Error ? error.message : String(error); }
}

console.log(JSON.stringify({ mode: repair ? 'repair' : 'report', ...report }, null, 2));
await prisma.$disconnect();
if (report.documentsWithoutXml.length || report.missingObjects.length || report.invalidXml.length) process.exitCode = 2;
}

main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    await prisma.$disconnect();
});
