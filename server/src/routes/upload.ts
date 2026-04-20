import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { inferAttachmentType, uploadBase64Object } from '../lib/objectStorage.js';

const router = Router();
const MAX_UPLOAD_SIZE_BYTES = Number(process.env.UPLOAD_MAX_SIZE_BYTES ?? 10 * 1024 * 1024);
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'text/'];
const ALLOWED_MIME_EXACT = [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

// POST /api/upload - upload a single file (base64 in JSON body for simplicity without multer)
// Body: { file: string (base64), filename: string, mimeType?: string }
router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { file: base64, filename, mimeType } = req.body || {};
        if (!base64 || !filename) {
            throw new AppError('file (base64) and filename are required', 400);
        }

        if (!mimeType) {
            throw new AppError('mimeType is required', 400);
        }

        const isAllowedPrefix = ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
        const isAllowedExact = ALLOWED_MIME_EXACT.includes(mimeType);
        if (!isAllowedPrefix && !isAllowedExact) {
            throw new AppError('Tipo de arquivo não permitido para upload', 400);
        }

        const estimatedSize = Math.floor((base64.length * 3) / 4);
        if (estimatedSize > MAX_UPLOAD_SIZE_BYTES) {
            throw new AppError(`Arquivo excede limite de ${Math.floor(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024))}MB`, 400);
        }

        const uploadResult = await uploadBase64Object({
            base64,
            fileName: filename,
            mimeType,
            keyPrefix: 'uploads/general',
        });

        res.json({
            success: true,
            data: {
                url: uploadResult.publicUrl ?? uploadResult.signedUrl,
                downloadUrl: uploadResult.signedUrl,
                filename,
                storageKey: uploadResult.storageKey,
                bucket: uploadResult.bucket,
                size: uploadResult.size,
                checksum: uploadResult.checksum,
                type: inferAttachmentType(mimeType),
            },
        });
    } catch (error) {
        next(error);
    }
});

export { router as uploadRouter };
