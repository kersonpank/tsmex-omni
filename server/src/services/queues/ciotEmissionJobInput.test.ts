import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCiotEmissionInputForJob } from './ciotEmissionJobInput.js';

function createBaseEntities() {
    const jobRecord = {
        id: 'job-1',
        manifestId: 'manifest-1',
        idOperacaoCliente: 'CIOT-manifest-1',
        tipoViagem: 'PADRAO',
        requestData: {
            documentoViagem: 'OS-100',
            distanciaPercorrida: 800,
            dataFimViagem: '2026-08-01T12:00:00',
            altoDesempenho: false,
            composicaoVeicular: false,
            tipoPagamento: 'TransferenciaBancaria',
            entregaDocumentacao: 'RedeCredenciada',
            valores: { totalOperacao: 3000, totalViagem: 3000, totalAdiantamento: 1000, totalQuitacao: 2000 },
            impostos: {},
            pagamentos: [],
            destinatario: {
                nomeOuRazaoSocial: 'Destino Ltda',
                cpfOuCnpj: '88777666000155',
                endereco: { bairro: 'Distrito', cep: '65000000', codigoMunicipio: 2111300, rua: 'Rua 1', numero: '10' },
            },
        },
    };

    const manifestRecord = {
        id: 'manifest-1',
        hubId: 'hub-1',
        destHubId: 'hub-2',
        fiscalEmitterId: null as string | null,
        hub: {
            id: 'hub-1',
            city: 'Imperatriz',
            state: 'MA',
            cityIbgeCode: '2105302',
            person: { id: 'person-hub', document: '11222333000181', legalName: 'Hub Imperatriz' },
        },
        destHub: {
            id: 'hub-2',
            city: 'Sao Luis',
            state: 'MA',
            cityIbgeCode: '2111300',
            person: { id: 'person-dest', document: '44555666000199', legalName: 'Hub Sao Luis' },
        },
        link: {
            id: 'link-1',
            document: '69641536400',
            rntrc: '123456789',
            carrierType: 'TAC',
            vehiclePlate: 'ABC1D23',
            trailerPlate: null,
            trailer2Plate: null,
            trailer3Plate: null,
            person: { id: 'person-link', document: '69641536400', legalName: 'Motorista TAC' },
        },
        driver: {
            id: 'driver-1',
            document: '69641536400',
            cnhNumber: '12345678901',
            phone: '81999346616',
            person: { id: 'person-driver', document: '69641536400', legalName: 'Motorista TAC' },
        },
        tripStops: [],
        destinationCity: undefined,
        destinationState: undefined,
        destinationCityIbgeCode: undefined,
    };

    const explicitEmitter = {
        id: 'emitter-explicit',
        hubId: 'hub-1',
        environment: 'PRODUCAO',
        efreteEnvironment: 'HOMOLOGACAO',
        active: true,
        defaultForHub: false,
        rntrc: '998877665',
        person: {
            id: 'person-explicit',
            document: '22333444000155',
            legalName: 'Emitente Selecionado Ltda',
            city: 'Guarulhos',
            state: 'SP',
            cityIbgeCode: '3518800',
            address: 'Rua das Flores',
            number: '123',
            neighborhood: 'Centro',
            cep: '65900000',
        },
    };

    const hubDefaultEmitter = {
        id: 'emitter-hub-default',
        hubId: 'hub-1',
        environment: 'PRODUCAO',
        efreteEnvironment: 'PRODUCAO',
        active: true,
        defaultForHub: true,
        rntrc: '112233445',
        person: {
            id: 'person-hub-default',
            document: '99888777000166',
            legalName: 'Emitente Padrao Hub Ltda',
            city: 'Guarulhos',
            state: 'SP',
            cityIbgeCode: '3518800',
            address: 'Av Principal',
            number: '500',
            neighborhood: 'Distrito',
            cep: '65900000',
        },
    };

    return { jobRecord, manifestRecord: manifestRecord as any, explicitEmitter, hubDefaultEmitter };
}

function makeDeps(jobRecord: any, manifestRecord: any, emitter: any, resolveIbgeMunicipio = async (city: string, state: string, ibge?: string) => ibge ?? `${city}-${state}`) {
    return {
        prisma: {
            ciotEmissionJob: { findUniqueOrThrow: async () => ({ ...jobRecord }) },
            manifest: { findUniqueOrThrow: async () => ({ ...manifestRecord }) },
            fiscalEmitter: { findUnique: async () => ({ ...emitter }), findFirst: async () => ({ ...emitter }) },
        } as any,
        resolveIbgeMunicipio,
    };
}

describe('buildCiotEmissionInputForJob fiscal emitter resolution and eFrete environment', () => {
    it('uses the selected physical origin and the contractor own address as independent municipalities', async () => {
        const { jobRecord, manifestRecord, hubDefaultEmitter } = createBaseEntities();
        Object.assign(manifestRecord, { originCity: 'São Paulo', originState: 'SP', originCityIbgeCode: '3550308' });
        const result = await buildCiotEmissionInputForJob('job-1', makeDeps(jobRecord, manifestRecord, hubDefaultEmitter) as any);
        assert.equal(result.mapperInput.codigoMunicipioOrigem, 3550308);
        assert.equal(result.mapperInput.contratante.endereco.codigoMunicipio, 3518800);
        assert.equal(result.mapperInput.codigoMunicipioDestino, 2111300);
    });
    it('maps cavalo and all trailers in normalized order', async () => {
        const { jobRecord, manifestRecord, hubDefaultEmitter } = createBaseEntities();
        Object.assign(manifestRecord.link, { vehiclePlate: 'abc-1d23', trailerPlate: ' DEF 456 ', trailer2Plate: 'GHI7J89', trailer3Plate: 'JKL-0M12' });
        const result = await buildCiotEmissionInputForJob('job-1', makeDeps(jobRecord, manifestRecord, hubDefaultEmitter) as any);
        assert.deepEqual(result.mapperInput.veiculos, ['ABC1D23', 'DEF456', 'GHI7J89', 'JKL0M12']);
    });

    it('removes empty, duplicate, and format-equivalent plates', async () => {
        const { jobRecord, manifestRecord, hubDefaultEmitter } = createBaseEntities();
        Object.assign(manifestRecord.link, { vehiclePlate: 'abc-1d23', trailerPlate: 'ABC1D23', trailer2Plate: '   ', trailer3Plate: null });
        const result = await buildCiotEmissionInputForJob('job-1', makeDeps(jobRecord, manifestRecord, hubDefaultEmitter) as any);
        assert.deepEqual(result.mapperInput.veiculos, ['ABC1D23']);
    });

    it('uses the last valid stop, skips invalid stops, then falls back to manifest sources', async () => {
        const { jobRecord, manifestRecord, hubDefaultEmitter } = createBaseEntities();
        manifestRecord.destHub = null;
        manifestRecord.tripStops = [
            { sequence: 1, destCity: 'Primeira', destState: 'MA', destCityIbgeCode: '1', destHub: null },
            { sequence: 2, destCity: '', destState: '', destCityIbgeCode: null, destHub: null },
            { sequence: 3, destCity: 'Ultima', destState: 'PA', destCityIbgeCode: '2', destHub: null },
        ];
        let destination = '';
        const result = await buildCiotEmissionInputForJob('job-1', makeDeps(jobRecord, manifestRecord, hubDefaultEmitter, async (city, state, ibge) => { destination = `${city}/${state}`; return ibge ?? 'x'; }) as any);
        assert.equal(destination, 'Ultima/PA');
        assert.equal(result.mapperInput.codigoMunicipioDestino, 2);

        manifestRecord.tripStops = [{ sequence: 1, destCity: '', destState: '', destCityIbgeCode: null, destHub: null }, { sequence: 2, destCity: 'Anterior', destState: 'PI', destCityIbgeCode: '3', destHub: null }];
        await buildCiotEmissionInputForJob('job-1', makeDeps(jobRecord, manifestRecord, hubDefaultEmitter, async (city, state, ibge) => ibge ?? 'x') as any);
        assert.equal(manifestRecord.tripStops[1].destCity, 'Anterior');
    });

    it('falls back from no valid stop to destHub, then manifest canonical destination', async () => {
        const { jobRecord, manifestRecord, hubDefaultEmitter } = createBaseEntities();
        manifestRecord.tripStops = [{ sequence: 1, destCity: '', destState: '', destHub: null }];
        let seen = '';
        await buildCiotEmissionInputForJob('job-1', makeDeps(jobRecord, manifestRecord, hubDefaultEmitter, async (city, state, ibge) => { seen = `${city}/${state}`; return ibge ?? '4'; }) as any);
        assert.equal(seen, 'Sao Luis/MA');
        manifestRecord.destHub = null;
        manifestRecord.destinationCity = 'Canonical City'; manifestRecord.destinationState = 'CE'; manifestRecord.destinationCityIbgeCode = '5';
        await buildCiotEmissionInputForJob('job-1', makeDeps(jobRecord, manifestRecord, hubDefaultEmitter, async (city, state, ibge) => { seen = `${city}/${state}`; return ibge ?? 'x'; }) as any);
        assert.equal(seen, 'Canonical City/CE');
    });

    it('rejects when no canonical destination exists', async () => {
        const { jobRecord, manifestRecord, hubDefaultEmitter } = createBaseEntities();
        manifestRecord.destHub = null; manifestRecord.tripStops = [];
        await assert.rejects(() => buildCiotEmissionInputForJob('job-1', makeDeps(jobRecord, manifestRecord, hubDefaultEmitter) as any), (err: any) => err.statusCode === 400);
    });
    it('same FiscalEmitter with environment=PRODUCAO and efreteEnvironment=HOMOLOGACAO: CIOT input returns homologacao', async () => {
        const { jobRecord, manifestRecord, explicitEmitter } = createBaseEntities();
        manifestRecord.fiscalEmitterId = explicitEmitter.id;

        const fakePrisma = {
            ciotEmissionJob: {
                findUniqueOrThrow: async () => ({ ...jobRecord }),
            },
            manifest: {
                findUniqueOrThrow: async () => ({ ...manifestRecord }),
            },
            fiscalEmitter: {
                findUnique: async ({ where }: { where: { id: string } }) => {
                    if (where.id === explicitEmitter.id) return { ...explicitEmitter };
                    return null;
                },
                findFirst: async () => {
                    throw new Error('findFirst should not be called when fiscalEmitterId is present');
                },
            },
        };

        const result = await buildCiotEmissionInputForJob('job-1', {
            prisma: fakePrisma as any,
            resolveIbgeMunicipio: async () => '2105302',
        });

        // Even though environment is PRODUCAO, efreteEnvironment is HOMOLOGACAO -> must return homologacao
        assert.equal(result.environment, 'homologacao');
        assert.equal(result.mapperInput.contratante.nomeOuRazaoSocial, 'Emitente Selecionado Ltda');
    });

    it('manifest.fiscalEmitterId wins over another active/default emitter on the same Hub', async () => {
        const { jobRecord, manifestRecord, explicitEmitter, hubDefaultEmitter } = createBaseEntities();
        manifestRecord.fiscalEmitterId = explicitEmitter.id;

        let findFirstCalled = false;
        let findUniqueCalledWithId: string | null = null;

        const fakePrisma = {
            ciotEmissionJob: {
                findUniqueOrThrow: async () => ({ ...jobRecord }),
            },
            manifest: {
                findUniqueOrThrow: async () => ({ ...manifestRecord }),
            },
            fiscalEmitter: {
                findUnique: async ({ where }: { where: { id: string } }) => {
                    findUniqueCalledWithId = where.id;
                    if (where.id === explicitEmitter.id) return { ...explicitEmitter };
                    return null;
                },
                findFirst: async () => {
                    findFirstCalled = true;
                    return { ...hubDefaultEmitter };
                },
            },
        };

        const result = await buildCiotEmissionInputForJob('job-1', {
            prisma: fakePrisma as any,
            resolveIbgeMunicipio: async () => '2105302',
        });

        assert.equal(findUniqueCalledWithId, explicitEmitter.id);
        assert.equal(findFirstCalled, false, 'findFirst should not be called when manifest has fiscalEmitterId');
        assert.equal(result.mapperInput.contratante.nomeOuRazaoSocial, 'Emitente Selecionado Ltda');
        assert.equal(result.mapperInput.contratante.cpfOuCnpj, '22333444000155');
    });

    it('fallback works only when Manifest.fiscalEmitterId is null', async () => {
        const { jobRecord, manifestRecord, hubDefaultEmitter } = createBaseEntities();

        // 1. When fiscalEmitterId is null: fallback succeeds
        manifestRecord.fiscalEmitterId = null;

        let findFirstCalled = false;
        const fakePrismaWithNullEmitter = {
            ciotEmissionJob: {
                findUniqueOrThrow: async () => ({ ...jobRecord }),
            },
            manifest: {
                findUniqueOrThrow: async () => ({ ...manifestRecord }),
            },
            fiscalEmitter: {
                findUnique: async () => null,
                findFirst: async () => {
                    findFirstCalled = true;
                    return { ...hubDefaultEmitter };
                },
            },
        };

        const result = await buildCiotEmissionInputForJob('job-1', {
            prisma: fakePrismaWithNullEmitter as any,
            resolveIbgeMunicipio: async () => '2105302',
        });

        assert.equal(findFirstCalled, true);
        assert.equal(result.mapperInput.contratante.nomeOuRazaoSocial, 'Emitente Padrao Hub Ltda');
        assert.equal(result.environment, 'producao');

        // 2. When fiscalEmitterId is non-null but does not exist: MUST NOT fall back to Hub default
        manifestRecord.fiscalEmitterId = 'non-existent-emitter-id';
        let fallbackAttempted = false;

        const fakePrismaWithMissingEmitter = {
            ciotEmissionJob: {
                findUniqueOrThrow: async () => ({ ...jobRecord }),
            },
            manifest: {
                findUniqueOrThrow: async () => ({ ...manifestRecord }),
            },
            fiscalEmitter: {
                findUnique: async () => null, // not found
                findFirst: async () => {
                    fallbackAttempted = true;
                    return { ...hubDefaultEmitter };
                },
            },
        };

        await assert.rejects(
            async () => {
                await buildCiotEmissionInputForJob('job-1', {
                    prisma: fakePrismaWithMissingEmitter as any,
                    resolveIbgeMunicipio: async () => '2105302',
                });
            },
            (err: any) => {
                assert.equal(fallbackAttempted, false, 'Must NOT fallback to Hub default when fiscalEmitterId is explicitly set');
                return true;
            },
        );
    });
});
