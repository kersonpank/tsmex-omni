import crypto from 'node:crypto';

/**
 * Cofre de segredos em repouso: AES-256-GCM, IV aleatório de 12 bytes, chave derivada de
 * `FISCAL_SECRET_KEY` (64 hex = chave direta; qualquer outro texto => SHA-256).
 *
 * Formato versionado: `v1:<iv b64>:<tag b64>:<dados b64>`. É o mesmo formato já gravado para a senha
 * do certificado do emitente fiscal, então valores antigos continuam legíveis.
 * Uso genérico: senha de certificado, chaves de LLM, credenciais de averbadora etc.
 */

const SEALED_RE = /^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]*={0,2}$/;

function resolveSecret(secret?: string): string {
    return secret ?? process.env.FISCAL_SECRET_KEY ?? '';
}

function deriveKey(secret: string): Buffer {
    if (/^[a-fA-F0-9]{64}$/.test(secret)) return Buffer.from(secret, 'hex');
    return crypto.createHash('sha256').update(secret).digest();
}

export function isSealedSecret(value: string | null | undefined): boolean {
    return typeof value === 'string' && SEALED_RE.test(value);
}

export function sealSecret(plain: string, secret?: string): string {
    const key = resolveSecret(secret);
    if (!key) throw new Error('FISCAL_SECRET_KEY is required to encrypt secrets');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(key), iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function openSecret(sealed: string, secret?: string): string {
    const key = resolveSecret(secret);
    if (!key) throw new Error('FISCAL_SECRET_KEY is required to decrypt secrets');
    const [version, ivRaw, tagRaw, dataRaw] = sealed.split(':');
    if (version !== 'v1' || !ivRaw || !tagRaw || dataRaw === undefined) {
        throw new Error('Unsupported secret format');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(key), Buffer.from(ivRaw, 'base64'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64')), decipher.final()]).toString('utf8');
}

/** Leitura tolerante: valor cifrado é aberto; texto puro legado é devolvido como está (migração gradual). */
export function openSecretOrLegacy(stored: string, secret?: string): string {
    return isSealedSecret(stored) ? openSecret(stored, secret) : stored;
}
