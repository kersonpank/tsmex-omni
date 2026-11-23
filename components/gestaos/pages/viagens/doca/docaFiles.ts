import { uploadApi } from '../../../../../lib/api';

export function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        reader.readAsDataURL(file);
    });
}

/** Envia um arquivo e devolve a URL e a chave de armazenamento. */
export async function sendFile(file: File): Promise<{ url: string; storageKey?: string }> {
    const sent = await uploadApi.upload(await readAsBase64(file), file.name, file.type || 'application/octet-stream');
    return { url: sent.data.url, storageKey: sent.data.storageKey };
}
