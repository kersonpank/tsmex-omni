import React from 'react';
import { manifestsApi } from '../../../../../lib/api';
import { Button } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';

/** Abre o PDF (URL assinada) de um documento fiscal autorizado em nova aba. */
export const PdfButton: React.FC<{ manifestId: string; documentId: string; label?: string }> = ({ manifestId, documentId, label = 'Abrir PDF' }) => {
    const { busy, run } = useAction();
    const open = async () => {
        await run(
            `pdf:${documentId}`,
            async () => {
                const { downloadUrl } = await manifestsApi.fiscalDocumentPdf(manifestId, documentId);
                window.open(downloadUrl, '_blank', 'noopener');
            },
            { success: 'PDF aberto em nova aba.', error: 'Não foi possível abrir o PDF agora.' },
        );
    };
    return (
        <Button size="sm" loading={busy === `pdf:${documentId}`} onClick={() => void open()}>
            {label}
        </Button>
    );
};
