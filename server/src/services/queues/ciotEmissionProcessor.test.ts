import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { processCiotEmissionJob } from './ciotEmissionProcessor.js';

function setup(phase: string, existing: boolean) {
    const calls: Array<[string, unknown[]]> = [];
    const ciotJob = { id: 'job-1', manifestId: 'manifest-1', idOperacaoCliente: 'op-1', phase, attemptCount: 0, maxAttempts: 3, codigoIdentificacaoOperacao: phase === 'DOWNLOADING_FILES' ? 'CIOT-1' : undefined, environment: phase === 'DOWNLOADING_FILES' ? 'PRODUCAO' : undefined };
    const deps: any = {
        prisma: {
            ciotEmissionJob: { findUniqueOrThrow: async () => ciotJob, update: async (...args: unknown[]) => calls.push(['update', [...args]]) },
            manifest: { findUniqueOrThrow: async () => ({ link: { id: 'link', vehiclePlate: 'ABC1D23', rntrc: '123456789', trailerPlate: 'REB1A11', tractionUnit: { id: 'u1', plate: 'ABC1D23', role: 'TRACTION', chassi: '9BWZZZ377VT004251', renavam: '12345678901', axles: 3, rntrc: '987654321', ownerDocument: '11222333000181', ownerName: 'Dono' } }, driver: { id: 'driver' } }) },
            manifestFiscalDocument: { create: async (...args: unknown[]) => calls.push(['document', [...args]]), findFirst: async () => null, update: async (...args: unknown[]) => calls.push(['document-update', [...args]]) },
        },
        buildCiotEmissionInputForJob: async () => ({ mapperInput: { tipoViagem: 'Padrao', idOperacaoCliente: 'op-1', matrizCnpj: '12345678901234', contratante: { nomeOuRazaoSocial: 'C', cpfOuCnpj: '12345678901234', endereco: { bairro: 'B', cep: '12345678', codigoMunicipio: 1, rua: 'R', numero: '1' } }, contratado: { cpfOuCnpj: '1', rntrc: '1' }, motorista: { cpfOuCnpj: '1', cnh: '1', celular: { ddd: 11, numero: 999999999 } }, codigoMunicipioOrigem: 1, codigoMunicipioDestino: 2, veiculos: ['ABC1D23'], requestData: { documentoViagem: 'D', distanciaPercorrida: 1, dataFimViagem: '2026-01-01', altoDesempenho: false, composicaoVeicular: false, tipoPagamento: 'TransferenciaBancaria', entregaDocumentacao: 'Cliente', valores: { totalOperacao: 1, totalViagem: 1, totalAdiantamento: 0, totalQuitacao: 1 }, impostos: {}, pagamentos: [], destinatario: { nomeOuRazaoSocial: 'D', cpfOuCnpj: '1', endereco: { bairro: 'B', cep: '12345678', codigoMunicipio: 2, rua: 'R', numero: '1' } } } }, environment: 'producao' }),
        ensureMotoristaRegistrado: async (...args: unknown[]) => calls.push(['motorista', [...args]]),
        ensureProprietarioRegistrado: async (...args: unknown[]) => calls.push(['proprietario', [...args]]),
        ensureVeiculoRegistrado: async (...args: unknown[]) => calls.push(['veiculo', [...args]]),
        consultarStatusCiot: async (...args: unknown[]) => { calls.push(['consulta', [...args]]); return { exists: existing, codigoIdentificacaoOperacao: existing ? 'CIOT-1' : undefined, protocoloServico: 'P-1' }; },
        submitCiotToEfrete: async (...args: unknown[]) => { calls.push(['submit', [...args]]); return { codigoIdentificacaoOperacao: 'CIOT-1', protocoloServico: 'P-1', raw: {} }; },
        obterCiotPdf: async (...args: unknown[]) => { calls.push(['pdf', [...args]]); return Buffer.from('%PDF-test').toString('base64'); },
        uploadBase64Object: async (...args: unknown[]) => { calls.push(['upload', [...args]]); return { storageKey: 'key' }; },
    };
    return { calls, deps, job: { data: { ciotEmissionJobId: 'job-1' } } as any };
}

describe('CIOT processor environment and idempotency', () => {
    it('forwards producao to registrations, consultation, and submission', async () => {
        const { calls, deps, job } = setup('QUEUED', false);
        await processCiotEmissionJob(job, deps);
        for (const name of ['motorista', 'proprietario', 'veiculo', 'consulta', 'submit']) {
            const call = calls.find(([kind]) => kind === name);
            assert.equal(call?.[1].at(-1), 'producao', name);
        }
    });

    it('registers one vehicle per plate (cavalo and reboque) and the owner with the cavalo RNTRC', async () => {
        const { calls, deps, job } = setup('QUEUED', false);
        await processCiotEmissionJob(job, deps);
        const plates = calls.filter(([kind]) => kind === 'veiculo').map(([, args]) => (args[0] as { plate: string }).plate);
        assert.deepEqual(plates, ['ABC1D23', 'REB1A11']);
        const owner = calls.find(([kind]) => kind === 'proprietario')?.[1][0] as { rntrc: string; vehicleOwnerDocument: string };
        assert.equal(owner.rntrc, '987654321');
        assert.equal(owner.vehicleOwnerDocument, '11222333000181');
    });

    it('consults existing CIOT with environment and does not submit', async () => {
        const { calls, deps, job } = setup('CADASTROS_ENSURING', true);
        await processCiotEmissionJob(job, deps);
        assert.equal(calls.find(([kind]) => kind === 'consulta')?.[1].at(-1), 'producao');
        assert.equal(calls.some(([kind]) => kind === 'submit'), false);
    });

    it('preserves DONE idempotency without external calls', async () => {
        const { calls, deps, job } = setup('DONE', false);
        await processCiotEmissionJob(job, deps);
        assert.deepEqual(calls, []);
    });
});
