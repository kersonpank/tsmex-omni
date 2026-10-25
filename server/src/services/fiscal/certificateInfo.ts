import forge from 'node-forge';

const CNPJ_OID = '2.16.76.1.3.3';

export interface Pkcs12Info {
    notBefore: Date;
    notAfter: Date;
    subjectCN: string | null;
    cnpj: string | null;
    serialNumber: string;
}

export class CertificateInfoError extends Error {
    readonly code = 'INVALID_PKCS12';

    constructor() {
        super('Senha do certificado incorreta ou arquivo inválido.');
        this.name = 'CertificateInfoError';
    }
}

function cnpjDigits(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const digits = value.replace(/\D/g, '');
    return digits.length === 14 ? digits : null;
}

function cnpjFromAsn1Value(value: forge.asn1.Asn1): string | null {
    if (typeof value.value === 'string') return cnpjDigits(value.value);
    for (const child of value.value) {
        const cnpj = cnpjFromAsn1Value(child);
        if (cnpj) return cnpj;
    }
    return null;
}

function cnpjFromOtherName(nodes: forge.asn1.Asn1[]): string | null {
    for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (node.type === forge.asn1.Type.OID && typeof node.value === 'string'
            && forge.asn1.derToOid(node.value) === CNPJ_OID && nodes[index + 1]) {
            const cnpj = cnpjFromAsn1Value(nodes[index + 1]);
            if (cnpj) return cnpj;
        }
        if (Array.isArray(node.value)) {
            const cnpj = cnpjFromOtherName(node.value);
            if (cnpj) return cnpj;
        }
    }
    return null;
}

function readCnpj(certificate: forge.pki.Certificate, subjectCN: string | null): string | null {
    const subjectCnpj = cnpjDigits(certificate.subject.getField({ type: CNPJ_OID })?.value);
    if (subjectCnpj) return subjectCnpj;

    const subjectAltName = certificate.getExtension('subjectAltName') as {
        altNames?: Array<{ type: number; value: string | forge.asn1.Asn1[] }>;
    } | null;
    for (const altName of subjectAltName?.altNames ?? []) {
        if (altName.type !== 0) continue;
        const nodes = typeof altName.value === 'string'
            ? [forge.asn1.fromDer(altName.value)]
            : altName.value;
        if (!Array.isArray(nodes)) continue;
        const cnpj = cnpjFromOtherName(nodes);
        if (cnpj) return cnpj;
    }

    return cnpjDigits(subjectCN?.match(/:\s*([\d./\-\s]+)$/)?.[1]);
}

function matchesPrivateKey(certificate: forge.pki.Certificate, key: forge.pki.PrivateKey): boolean {
    const publicKey = certificate.publicKey;
    return typeof publicKey === 'object' && 'n' in publicKey && 'e' in publicKey
        && typeof key === 'object' && 'n' in key && 'e' in key
        && publicKey.n.compareTo(key.n) === 0 && publicKey.e.compareTo(key.e) === 0;
}

function isCa(certificate: forge.pki.Certificate): boolean {
    const basicConstraints = certificate.getExtension('basicConstraints') as { cA?: boolean } | null;
    return basicConstraints?.cA === true;
}

export function readPkcs12Info(base64: string, password: string): Pkcs12Info {
    try {
        const encoded = base64.replace(/\s/g, '');
        if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
            throw new CertificateInfoError();
        }

        const asn1 = forge.asn1.fromDer(Buffer.from(encoded, 'base64').toString('binary'));
        const pkcs12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
        const bags = pkcs12.safeContents.flatMap((contents) => contents.safeBags);
        const privateKeys = bags.flatMap((bag) => bag.key ? [bag.key] : []);
        const certificates = bags.flatMap((bag) => bag.cert ? [bag.cert] : []);
        const certificate = certificates.find((candidate) => !isCa(candidate)
            && privateKeys.some((key) => matchesPrivateKey(candidate, key)));
        if (!certificate) throw new CertificateInfoError();

        const cn = certificate.subject.getField('CN')?.value;
        const subjectCN = typeof cn === 'string' ? cn : null;
        return {
            notBefore: certificate.validity.notBefore,
            notAfter: certificate.validity.notAfter,
            subjectCN,
            cnpj: readCnpj(certificate, subjectCN),
            serialNumber: certificate.serialNumber,
        };
    } catch {
        throw new CertificateInfoError();
    }
}
