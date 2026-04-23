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

const endpoint = process.env.S3_ENDPOINT ?? process.env.MINIO_ENDPOINT;
const accessKeyId = process.env.S3_ACCESS_KEY ?? process.env.MINIO_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY ?? process.env.MINIO_SECRET_KEY;
const region = process.env.S3_REGION ?? process.env.MINIO_REGION ?? 'us-east-1';
const bucket = process.env.S3_BUCKET ?? process.env.MINIO_BUCKET ?? 'tsm-ex-uploads';
const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true';
const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL ?? process.env.MINIO_PUBLIC_BASE_URL;

if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing MinIO/S3 env vars. Configure endpoint, access key and secret key.');
}

const s3Client = new S3Client({
    endpoint,
    region,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
});

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

    await s3Client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: storageKey,
            Body: buffer,
            ContentType: params.mimeType ?? 'application/octet-stream',
        })
    );

    const signedUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
        { expiresIn: 60 * 60 }
    );

    return {
        bucket,
        storageKey,
        checksum,
        size: buffer.length,
        signedUrl,
        publicUrl: publicBaseUrl ? `${publicBaseUrl.replace(/\/$/, '')}/${storageKey}` : null,
    };
}

export async function deleteObjectByKey(storageKey: string): Promise<void> {
    await s3Client.send(
        new DeleteObjectCommand({
            Bucket: bucket,
            Key: storageKey,
        })
    );
}

export async function getObjectDownloadUrl(storageKey: string, expiresInSeconds = 3600): Promise<string> {
    return getSignedUrl(
        s3Client,
        new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
        { expiresIn: expiresInSeconds }
    );
}

export async function ensureBucketExists(): Promise<void> {
    try {
        await s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err: any) {
        if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404 || err.name === 'NoSuchBucket') {
            await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
            console.log(`S3 bucket "${bucket}" criado.`);
        } else {
            throw err;
        }
    }
}
