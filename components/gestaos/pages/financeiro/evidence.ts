import { uploadApi } from '../../../../lib/api';

/** Limite do comprovante (o servidor também recusa acima disso). */
export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;

export function evidenceError(file: File | null): string | null {
    if (!file) return null;
    return file.size > MAX_EVIDENCE_BYTES ? 'O comprovante passa de 8 MB.' : null;
}

function readBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('Não foi possível ler o comprovante.'));
        reader.readAsDataURL(file);
    });
}

/** Envia o comprovante e devolve a chave de armazenamento para o corpo da baixa (como a clássica). */
export async function uploadEvidence(file: File | undefined): Promise<string | undefined> {
    if (!file) return undefined;
    const base64 = await readBase64(file);
    return (await uploadApi.upload(base64, file.name, file.type || 'application/pdf')).data.storageKey;
}
