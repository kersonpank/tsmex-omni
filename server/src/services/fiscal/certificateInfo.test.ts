import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import forge from 'node-forge';

import { CertificateInfoError, readPkcs12Info } from './certificateInfo.js';

const password = 'senha-do-certificado';
const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
const otherKeys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
const notBefore = new Date('2026-10-01T00:00:00.000Z');
const notAfter = new Date('2027-10-01T23:59:59.000Z');

function createCertificate(options: {
    commonName?: string;
    attributes?: forge.pki.CertificateField[];
    extensions?: object[];
    keyPair?: forge.pki.rsa.KeyPair;
    ca?: boolean;
    expiresAt?: Date;
} = {}): forge.pki.Certificate {
    const keyPair = options.keyPair ?? keys;
    const certificate = forge.pki.createCertificate();
    certificate.publicKey = keyPair.publicKey;
    certificate.serialNumber = '0123456789abcdef';
    certificate.validity.notBefore = notBefore;
    certificate.validity.notAfter = options.expiresAt ?? notAfter;
    certificate.setSubject([
        { name: 'commonName', value: options.commonName ?? 'TRANSPORTADORA TESTE:12.345.678/0001-95' },
        ...(options.attributes ?? []),
    ]);
    certificate.setIssuer(certificate.subject.attributes);
    certificate.setExtensions([
        { name: 'basicConstraints', cA: options.ca ?? false },
        ...(options.extensions ?? []),
    ]);
    certificate.sign(keyPair.privateKey, forge.md.sha256.create());
    return certificate;
}

function createPkcs12(
    certificate: forge.pki.Certificate | forge.pki.Certificate[],
    key: forge.pki.PrivateKey | null = keys.privateKey,
): string {
    const pkcs12 = forge.pkcs12.toPkcs12Asn1(key, certificate, password, { algorithm: '3des' });
    return forge.util.encode64(forge.asn1.toDer(pkcs12).getBytes());
}

describe('readPkcs12Info', () => {
    it('lê a validade, o CNPJ do CN e o número de série do próprio certificado', () => {
        const info = readPkcs12Info(createPkcs12(createCertificate()), password);

        assert.deepEqual(info, {
            notBefore,
            notAfter,
            subjectCN: 'TRANSPORTADORA TESTE:12.345.678/0001-95',
            cnpj: '12345678000195',
            serialNumber: '0123456789abcdef',
        });
    });

    it('escolhe o certificado final com a chave correspondente, mesmo após uma CA e outro certificado', () => {
        const ca = createCertificate({ ca: true, expiresAt: new Date('2036-10-01T00:00:00.000Z') });
        const unrelated = createCertificate({ keyPair: otherKeys, commonName: 'OUTRA EMPRESA:98765432000198' });
        const certificate = createCertificate();

        const info = readPkcs12Info(createPkcs12([ca, unrelated, certificate]), password);

        assert.deepEqual(info.notAfter, notAfter);
        assert.equal(info.cnpj, '12345678000195');
    });

    it('lê o CNPJ do atributo de assunto OID 2.16.76.1.3.3 sem CNPJ no CN', () => {
        const certificate = createCertificate({
            commonName: 'TRANSPORTADORA TESTE',
            attributes: [{ type: '2.16.76.1.3.3', value: '12345678000195' }],
        });

        const info = readPkcs12Info(createPkcs12(certificate), password);

        assert.equal(info.cnpj, '12345678000195');
    });

    it('lê o CNPJ do otherName no subjectAltName usado pela ICP-Brasil', () => {
        const subjectAltName = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
            forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
                forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
                    forge.asn1.oidToDer('2.16.76.1.3.3').getBytes()),
                forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
                    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false,
                        '12345678000195'),
                ]),
            ]),
        ]);
        const certificate = createCertificate({
            commonName: 'TRANSPORTADORA TESTE',
            extensions: [{
                id: '2.5.29.17',
                value: forge.asn1.toDer(subjectAltName).getBytes(),
            }],
        });

        const info = readPkcs12Info(createPkcs12(certificate), password);

        assert.equal(info.cnpj, '12345678000195');
    });

    it('retorna CNPJ ausente quando o certificado não contém uma identificação de CNPJ', () => {
        const info = readPkcs12Info(createPkcs12(createCertificate({ commonName: 'TRANSPORTADORA TESTE' })), password);

        assert.equal(info.cnpj, null);
    });

    it('lança erro tipado quando a senha está incorreta', () => {
        const base64 = createPkcs12(createCertificate());

        assert.throws(() => readPkcs12Info(base64, 'senha-incorreta'), (error: unknown) => {
            assert.ok(error instanceof CertificateInfoError);
            assert.equal(error.code, 'INVALID_PKCS12');
            assert.equal(error.message, 'Senha do certificado incorreta ou arquivo inválido.');
            return true;
        });
    });

    it('lança erro tipado quando o arquivo é inválido', () => {
        assert.throws(() => readPkcs12Info('arquivo inválido', password), CertificateInfoError);
        assert.throws(() => readPkcs12Info(Buffer.from('não é um PKCS12').toString('base64'), password), CertificateInfoError);
    });

    it('rejeita arquivos sem a chave privada do certificado final', () => {
        assert.throws(() => readPkcs12Info(createPkcs12(createCertificate(), null), password), CertificateInfoError);
        assert.throws(() => readPkcs12Info(createPkcs12(createCertificate(), otherKeys.privateKey), password), CertificateInfoError);
    });
});
