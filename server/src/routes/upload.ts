import { Router, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

function ensureUploadDir() {
    if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
}

// POST /api/upload - upload a single file (base64 in JSON body for simplicity without multer)
// Body: { file: string (base64), filename: string, mimeType?: string }
router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { file: base64, filename, mimeType } = req.body || {};
        if (!base64 || !filename) {
            throw new AppError('file (base64) and filename are required', 400);
        }
        ensureUploadDir();
        const ext = path.extname(filename) || (mimeType && mimeType.startsWith('image/') ? '.jpg' : '.bin');
        const safeName = `${Date.now()}-${(filename || 'file').replace(/[^a-zA-Z0-9.-]/g, '_')}${ext}`;
        const filePath = path.join(UPLOAD_DIR, safeName);
        const buffer = Buffer.from(base64, 'base64');
        fs.writeFileSync(filePath, buffer);
        const url = `/api/uploads/${safeName}`;
        res.json({ success: true, data: { url, filename: safeName } });
    } catch (error) {
        next(error);
    }
});

export { router as uploadRouter };
