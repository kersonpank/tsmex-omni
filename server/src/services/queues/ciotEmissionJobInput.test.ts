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
            person: { id: 'person-link', document: '69641536400', legalName: 'Motorista TAC' },
        },
        driver: {
            id: 'driver-1',
            document: '69641536400',
            cnhNumber: '12345678901',
            phone: '81999346616',
            person: { id: 'person-driver', document: '69641536400', legalName: 'Motorista TAC' },
        },
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
            address: 'Av Principal',
            number: '500',
            neighborhood: 'Distrito',
            cep: '65900000',
        },
    };

    return { jobRecord, manifestRecord, explicitEmitter, hubDefaultEmitter };
}

describe('buildCiotEmissionInputForJob fiscal emitter resolution and eFrete environment', () => {
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
