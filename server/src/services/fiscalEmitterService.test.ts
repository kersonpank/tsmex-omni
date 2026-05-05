import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    buildFiscalEmitterReadiness,
    decryptCertificatePassword,
    encryptCertificatePassword,
    type FiscalEmitterReadinessInput,
} from './fiscalEmitterService.js';

const readyEmitter: FiscalEmitterReadinessInput = {
    person: {
        documentType: 'CNPJ',
        document: '26879820000270',
        legalName: 'L M DA SILVA TRANSPORTES - ME',
        stateRegistration: '796630902112',
        address: 'Rua Merces',
        number: '210',
        neighborhood: 'Cidade Industrial Satelite de Sao Paulo',
        city: 'GUARULHOS',
        state: 'SP',
        cep: '07223050',
    },
    rntrc: '49827766',
    crt: '1',
    cteSeries: 1,
    environment: 'HOMOLOGACAO',
    certificateStorageKey: 'fiscal/emitters/1/certificates/a1.pfx',
    certificatePasswordEncrypted: 'encrypted',
};

describe('certificate password encryption', () => {
    it('criptografa senha A1 sem manter texto puro e permite descriptografar', () => {
        const encrypted = encryptCertificatePassword('senha-super-secreta', '0'.repeat(64));

        assert.notEqual(encrypted, 'senha-super-secreta');
        assert.match(encrypted, /^v1:/);
        assert.equal(decryptCertificatePassword(encrypted, '0'.repeat(64)), 'senha-super-secreta');
    });
});

describe('buildFiscalEmitterReadiness', () => {
    it('marca emitente como pronto para minuta e homologação quando dados mínimos existem', () => {
        const readiness = buildFiscalEmitterReadiness(readyEmitter);

        assert.equal(readiness.readyForMinuta, true);
        assert.equal(readiness.readyForHomologation, true);
        assert.equal(readiness.readyForProduction, false);
        assert.deepEqual(readiness.issues, []);
    });

    it('lista pendências do emitente credenciado para CT-e', () => {
        const readiness = buildFiscalEmitterReadiness({
            ...readyEmitter,
            person: { ...readyEmitter.person, documentType: 'CPF', address: null, cep: null },
            rntrc: '',
            crt: null,
            cteSeries: null,
            certificateStorageKey: null,
            certificatePasswordEncrypted: null,
        });

        assert.equal(readiness.readyForMinuta, false);
        assert.equal(readiness.readyForHomologation, false);
        assert.ok(readiness.issues.includes('Emitente deve ser uma Pessoa Jurídica (CNPJ).'));
        assert.ok(readiness.issues.includes('Emitente precisa de endereço fiscal completo.'));
        assert.ok(readiness.issues.includes('RNTRC é obrigatório para CT-e/MDF-e.'));
        assert.ok(readiness.issues.includes('CRT/regime tributário é obrigatório.'));
        assert.ok(readiness.issues.includes('Série CT-e é obrigatória.'));
        assert.ok(readiness.issues.includes('Certificado A1 e senha são obrigatórios para homologação/produção.'));
    });

    it('exige CFOP e CST padrão do CT-e para emitente ACBr', () => {
        const readiness = buildFiscalEmitterReadiness({
            ...readyEmitter,
            provider: 'ACBR',
            defaultCteCfop: null,
            defaultCteCst: null,
        });

        assert.equal(readiness.readyForMinuta, false);
        assert.ok(readiness.issues.some((i) => i.includes('CFOP padrão do CT-e')));
        assert.ok(readiness.issues.some((i) => i.includes('CST padrão do CT-e')));
    });

    it('aceita emitente ACBr com CFOP/CST padrão definidos', () => {
        const readiness = buildFiscalEmitterReadiness({
            ...readyEmitter,
            provider: 'ACBR',
            defaultCteCfop: '6352',
            defaultCteCst: '00',
        });

        assert.equal(readiness.readyForHomologation, true);
        assert.deepEqual(readiness.issues, []);
    });
});
