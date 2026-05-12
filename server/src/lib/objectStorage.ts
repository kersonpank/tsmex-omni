import crypto from 'crypto';
import {
    CreateBucketCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function normalizeUrlEnv(rawValue?: string | null): string | null {
    if (!rawValue) return null;
    return rawValue.trim().replace(/[{}]/g, '');
}

const endpoint = normalizeUrlEnv(process.env.S3_ENDPOINT ?? process.env.MINIO_ENDPOINT);
const accessKeyId = process.env.S3_ACCESS_KEY ?? process.env.MINIO_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY ?? process.env.MINIO_SECRET_KEY;
const region = process.env.S3_REGION ?? process.env.MINIO_REGION ?? 'us-east-1';
const bucket = process.env.S3_BUCKET ?? process.env.MINIO_BUCKET ?? 'tsm-ex-uploads';
const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true';
const publicBaseUrl = normalizeUrlEnv(process.env.S3_PUBLIC_BASE_URL ?? process.env.MINIO_PUBLIC_BASE_URL);
const signedUrlPublicHost = normalizeUrlEnv(process.env.S3_SIGNED_URL_PUBLIC_HOST) ?? publicBaseUrl ?? null;
const isProduction = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';

export function isObjectStorageConfigured(): boolean {
    return Boolean(endpoint && accessKeyId && secretAccessKey);
}

function isPrivateIpv4(hostname: string): boolean {
    const parts = hostname.split('.').map((segment) => Number(segment));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
}

function isInternalHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    if (!normalized) return true;
    if (normalized === 'localhost' || normalized === 'minio') return true;
    if (normalized.endsWith('.local') || normalized.endsWith('.internal')) return true;
    if (isPrivateIpv4(normalized)) return true;
    return false;
}

function assertProductionSafeEndpoint(rawEndpoint: string): void {
    if (/[{}]/.test(rawEndpoint)) {
        throw new Error(
            `Invalid S3 endpoint "${rawEndpoint}". Remove invalid characters and use format "https://minio.example.com".`
        );
    }

    let parsed: URL;
    try {
        parsed = new URL(rawEndpoint);
    } catch {
        throw new Error(`Invalid S3 endpoint "${rawEndpoint}". Use a full URL like "https://minio.example.com".`);
    }

    if (parsed.protocol !== 'https:') {
        throw new Error(`Unsafe S3 endpoint "${rawEndpoint}" in production. Configure S3 endpoint with HTTPS.`);
    }

    if (isInternalHostname(parsed.hostname)) {
        throw new Error(
            `Unsafe S3 endpoint "${rawEndpoint}" in production. Configure S3 endpoint with a public hostname reachable by the browser.`
        );
    }
}

function rewriteSignedUrlToPublicHost(url: string): string {
    const hostOverride = signedUrlPublicHost?.trim();
    if (!hostOverride) return url;
    if (/[{}]/.test(hostOverride)) return url;

    try {
        const signed = new URL(url);
        const publicHost = new URL(hostOverride);
        signed.protocol = publicHost.protocol;
        signed.host = publicHost.host;
        return signed.toString();
    } catch {
        return url;
    }
}

if (isProduction && endpoint) {
    assertProductionSafeEndpoint(endpoint);
}

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
    if (!endpoint || !accessKeyId || !secretAccessKey) {
        throw new Error('Missing MinIO/S3 env vars. Configure endpoint, access key and secret key.');
    }
    if (!s3Client) {
        s3Client = new S3Client({
            endpoint,
            region,
            forcePathStyle,
            credentials: { accessKeyId, secretAccessKey },
        });
    }
    return s3Client;
}

function sanitizeFileName(fileName: string): string {
    return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function normalizeBase64(input: string): string {
    const marker = 'base64,';
    const markerIndex = input.indexOf(marker);
    if (markerIndex >= 0) {
        return input.slice(markerIndex + marker.length);
    }
    return input;
}

export function inferAttachmentType(mimeType?: string): 'IMAGE' | 'DOCUMENT' | 'OTHER' {
    if (!mimeType) return 'OTHER';
    if (mimeType.startsWith('image/')) return 'IMAGE';
    if (
        mimeType.includes('pdf') ||
        mimeType.includes('word') ||
        mimeType.includes('sheet') ||
        mimeType.includes('text/') ||
        mimeType.includes('document')
    ) {
        return 'DOCUMENT';
    }
    return 'OTHER';
}

export function buildStorageKey(prefix: string, fileName: string): string {
    const safeName = sanitizeFileName(fileName);
    return `${prefix}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
}

export async function uploadBase64Object(params: {
    base64: string;
    fileName: string;
    mimeType?: string;
    keyPrefix: string;
}) {
    const normalized = normalizeBase64(params.base64);
    const buffer = Buffer.from(normalized, 'base64');
    const storageKey = buildStorageKey(params.keyPrefix, params.fileName);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    const client = getS3Client();

    await client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: storageKey,
            Body: buffer,
            ContentType: params.mimeType ?? 'application/octet-stream',
        })
    );

    const signedUrl = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
        { expiresIn: 60 * 60 }
    );

    return {
        bucket,
        storageKey,
        checksum,
        size: buffer.length,
        signedUrl: rewriteSignedUrlToPublicHost(signedUrl),
        publicUrl: publicBaseUrl ? `${publicBaseUrl.replace(/\/$/, '')}/${storageKey}` : null,
    };
}

export async function deleteObjectByKey(storageKey: string): Promise<void> {
    await getS3Client().send(
        new DeleteObjectCommand({
            Bucket: bucket,
            Key: storageKey,
        })
    );
}

export async function getObjectDownloadUrl(storageKey: string, expiresInSeconds = 3600): Promise<string> {
    const signedUrl = await getSignedUrl(
        getS3Client(),
        new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
        { expiresIn: expiresInSeconds }
    );
    return rewriteSignedUrlToPublicHost(signedUrl);
}

export async function ensureBucketExists(): Promise<void> {
    try {
        const client = getS3Client();
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err: any) {
        if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404 || err.name === 'NoSuchBucket') {
            await getS3Client().send(new CreateBucketCommand({ Bucket: bucket }));
            console.log(`S3 bucket "${bucket}" criado.`);
        } else {
            throw err;
        }
    }
}
