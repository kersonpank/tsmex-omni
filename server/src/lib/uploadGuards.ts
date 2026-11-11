import { AppError } from '../middleware/errorHandler.js';

/** MIME types que executam script no navegador quando servidos do mesmo storage. */
const BLOCKED_MIME = new Set(['image/svg+xml', 'text/html', 'application/xhtml+xml']);

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
    'image/png': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    'image/jpg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    'application/pdf': (b) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-',
};

function stripDataUrl(input: string): string {
    const marker = 'base64,';
    const i = input.indexOf(marker);
    return i >= 0 ? input.slice(i + marker.length) : input;
}

/** Valida o tipo declarado de um upload feito por usuário: bloqueia tipos ativos e confere os "magic bytes". */
export function assertSafeUpload(mimeType: string, base64: string, fileName?: string): void {
    const mime = String(mimeType ?? '').trim().toLowerCase().split(';')[0];
    if (BLOCKED_MIME.has(mime)) {
        throw new AppError('Tipo de arquivo não permitido para upload', 400);
    }
    if (fileName && /\.(svg|svgz|html?|xhtml)$/i.test(fileName.trim())) {
        throw new AppError('Tipo de arquivo não permitido para upload', 400);
    }
    const check = SIGNATURES[mime];
    if (check) {
        const head = Buffer.from(stripDataUrl(base64).slice(0, 32), 'base64');
        if (!check(head)) {
            throw new AppError('O conteúdo do arquivo não corresponde ao tipo declarado', 400);
        }
    }
}
