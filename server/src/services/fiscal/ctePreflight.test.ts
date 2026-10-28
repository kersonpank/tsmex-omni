import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CteEmissionInput } from '../cteService.js';
import { buildCtePreflightResult } from './ctePreflight.js';

const completeInput: CteEmissionInput = {
    calc: {
        id: 'calc-1',
        originCity: 'Imperatriz',
        destCity: 'São Luís',
        cfop: '6352',
        cst: '00',
        tipoFrete: 'Normal',
        volumes: 3,
        weight: 120,
        effectiveWeight: 120,
        cubage: 0.4,
        nfValue: 1500,
        commodity: 'Medicamentos',
        freightTotal: 320,
        breakdown: { freightBase: 280, icms: 40 },
        icmsValue: 40,
    },
    order: {
        freightTerm: 'CIF',
        serviceStart: { city: 'Imperatriz', state: 'MA', ibgeCode: '2105302' },
        serviceEnd: { city: 'Belém', state: 'PA', ibgeCode: '1501402' },
        remetentePerson: {
            legalName: 'Remetente SA',
            document: '12345678000190',
            stateRegistration: '123456789',
            address: 'Rua A',
            number: '100',
            neighborhood: 'Centro',
            city: 'Imperatriz',
            state: 'MA',
            cep: '65900000',
        },
        destinatarioPerson: {
            legalName: 'Destinatario SA',
            document: '98765432000110',
            stateRegistration: '987654321',
            address: 'Rua B',
            number: '200',
            neighborhood: 'Centro',
            city: 'São Luís',
            state: 'MA',
            cep: '65000000',
        },
        consignatarioPerson: null,
        expedidorPerson: null,
        invoicesRel: [{
            type: 'NFE',
            nfNumber: '123',
            nfKey: '1'.repeat(44),
            volumes: 3,
            weight: 120,
            value: 1500,
        }],
    },
    hub: {
        id: 'hub-1',
        name: 'HUB Imperatriz',
        code: 'IMP-MA',
        phone: '999999999',
        rntrc: '12345678',
    },
    person: {
        legalName: 'TSM EX LTDA',
        document: '11222333000144',
        stateRegistration: '123456789',
        address: 'Av Central',
        number: '10',
        neighborhood: 'Centro',
        city: 'Imperatriz',
        state: 'MA',
        cep: '65900000',
    },
    numero: 0,
    serie: 1,
    ambiente: 'HOMOLOGACAO',
};

describe('buildCtePreflightResult', () => {
    function withAcbrCredentials<T>(fn: () => T): T {
        const env = {
            ACBR_CLIENT_ID: process.env.ACBR_CLIENT_ID,
            ACBR_CLIENT_SECRET: process.env.ACBR_CLIENT_SECRET,
            FISCAL_CTE_PROVIDER: process.env.FISCAL_CTE_PROVIDER,
            FISCAL_PROVIDER: process.env.FISCAL_PROVIDER,
        };
        process.env.ACBR_CLIENT_ID = 'client-id';
        process.env.ACBR_CLIENT_SECRET = 'client-secret';
        delete process.env.FISCAL_CTE_PROVIDER;
        delete process.env.FISCAL_PROVIDER;
        try {
            return fn();
        } finally {
            for (const [key, value] of Object.entries(env)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    }

    it('aprova CT-e pronto sem alterar estado fiscal', () => {
        const result = withAcbrCredentials(() => buildCtePreflightResult(completeInput, {
            provider: 'ACBR',
        }));

        assert.equal(result.ok, true);
        assert.equal(result.canEmit, true);
        assert.equal(result.environment, 'HOMOLOGACAO');
        assert.equal(result.provider, 'ACBR');
        assert.deepEqual(result.issues, []);
        assert.deepEqual(result.missingFields, []);
        assert.equal(result.tax.cfop?.code, '6352');
        assert.equal(result.tax.cst?.code, '00');
        assert.equal(result.providerDecision.willUseAcbrHttp, true);
        assert.equal(result.providerDecision.reason, 'emitter_provider_acbr');
    });

    it('bloqueia emitente ACBr pronto quando credenciais OAuth não chegam na API', () => {
        const env = {
            ACBR_CLIENT_ID: process.env.ACBR_CLIENT_ID,
            ACBR_CLIENT_SECRET: process.env.ACBR_CLIENT_SECRET,
            FISCAL_CTE_PROVIDER: process.env.FISCAL_CTE_PROVIDER,
            FISCAL_PROVIDER: process.env.FISCAL_PROVIDER,
        };
        delete process.env.ACBR_CLIENT_ID;
        delete process.env.ACBR_CLIENT_SECRET;
        delete process.env.FISCAL_CTE_PROVIDER;
        delete process.env.FISCAL_PROVIDER;

        const result = buildCtePreflightResult(completeInput, {
            provider: 'ACBR',
        });

        try {
            assert.equal(result.ok, false);
            assert.equal(result.canEmit, false);
            assert.equal(result.providerDecision.willUseAcbrHttp, false);
            assert.equal(result.providerDecision.reason, 'missing_credentials');
            assert.ok(result.issues.some((issue) => issue.includes('ACBR_CLIENT_ID')));
        } finally {
            for (const [key, value] of Object.entries(env)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });

    it('lista pendências de preenchimento e CST inválido antes do envio', () => {
        const result = buildCtePreflightResult({
            ...completeInput,
            calc: { ...completeInput.calc, cfop: null, cst: '99' },
        });

        assert.equal(result.ok, false);
        assert.equal(result.canEmit, false);
        assert.ok(result.issues.includes('CT-e precisa de CFOP.'));
        assert.ok(result.issues.includes('CST 99 não está habilitado para CT-e no MVP.'));
        assert.ok(result.missingFields.includes('cfop'));
        assert.equal(result.tax.cst, null);
    });

    it('aceita pendências externas quando ainda não há input completo', () => {
        const result = buildCtePreflightResult(null, {
            environment: 'HOMOLOGACAO',
            provider: 'ACBR',
            additionalIssues: ['É obrigatório vincular um emitente credenciado ativo a este cálculo para emitir CT-e.'],
            additionalMissingFields: ['fiscalEmitterId'],
        });

        assert.equal(result.ok, false);
        assert.equal(result.canEmit, false);
        assert.deepEqual(result.missingFields, ['fiscalEmitterId']);
    });

    it('bloqueia emissão quando input é nulo mesmo sem pendências externas', () => {
        const result = buildCtePreflightResult(null, {
            environment: 'HOMOLOGACAO',
            provider: 'ACBR',
        });

        assert.equal(result.ok, false);
        assert.equal(result.canEmit, false);
        assert.ok(result.issues.includes('Dados de cálculo e pedido são obrigatórios para o preflight completo do CT-e.'));
        assert.deepEqual(result.missingFields, []);
        assert.equal(result.tax.cfop, null);
        assert.equal(result.tax.cst, null);
    });

    it('aplica 519, 524 e 908 às UFs reais da prestação e do emitente', () => {
        const check = (cfop: string, start: string, end: string, emitter: string) => buildCtePreflightResult({
            ...completeInput,
            calc: { ...completeInput.calc, cfop },
            order: { ...completeInput.order, serviceStart: { city: 'Início', state: start }, serviceEnd: { city: 'Fim', state: end } },
            person: { ...completeInput.person, state: emitter },
        });

        assert.ok(check('6352', 'MA', 'MA', 'MA').issues.some((issue) => issue.includes('519')));
        assert.ok(check('6352', 'MA', 'MA', 'MA').missingFields.includes('cfop'));
        assert.ok(check('5352', 'MA', 'PA', 'MA').issues.some((issue) => issue.includes('519')));
        assert.ok(check('6352', 'MA', 'EX', 'MA').issues.some((issue) => issue.includes('519')));
        assert.ok(check('5352', 'MA', 'MA', 'SP').issues.some((issue) => issue.includes('524')));
        assert.ok(check('5352', 'MA', 'MA', 'SP').missingFields.includes('cfop'));
        assert.ok(check('6352', 'MA', 'PA', 'SP').issues.some((issue) => issue.includes('524')));
        assert.ok(check('5932', 'MA', 'MA', 'MA').issues.some((issue) => issue.includes('908')));
        assert.ok(check('5932', 'MA', 'MA', 'MA').missingFields.includes('cfop'));
        assert.ok(check('6932', 'MA', 'PA', 'MA').issues.some((issue) => issue.includes('908')));
        for (const [cfop, start, end, emitter] of [
            ['5352', 'MA', 'MA', 'MA'], ['6352', 'MA', 'PA', 'MA'],
            ['5932', 'MA', 'MA', 'SP'], ['6932', 'MA', 'PA', 'SP'], ['7358', 'MA', 'EX', 'SP'],
        ]) {
            assert.ok(!check(cfop, start, end, emitter).issues.some((issue) => /SEFAZ (519|524|908)/.test(issue)), `${cfop} ${start} ${end} ${emitter}`);
        }
    });

    it('não deduz UFs da prestação pelas partes quando o contrato de localização está ausente', () => {
        const result = buildCtePreflightResult({
            ...completeInput,
            order: { ...completeInput.order, serviceStart: null, serviceEnd: null },
        });
        assert.ok(result.warnings.some((warning) => warning.includes('519/524/908')));
        assert.ok(!result.issues.some((issue) => /SEFAZ (519|524|908)/.test(issue)));
    });
});
