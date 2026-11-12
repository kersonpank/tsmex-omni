import React, { useState } from 'react';
import { manifestsApi } from '../../../../lib/api';
import { OsButton } from '../../ui/kit';
import { apiErrorMessage } from '../../ui/Sheet';

/** "Abrir PDF" de um documento fiscal autorizado (CIOT ou DAMDFE do MDF-e): pede a URL assinada e abre em nova aba. */
const FiscalPdfButton: React.FC<{ manifestId: string; documentId: string; label?: string }> = ({ manifestId, documentId, label = 'Abrir PDF' }) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const open = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            const { downloadUrl } = await manifestsApi.fiscalDocumentPdf(manifestId, documentId);
            window.open(downloadUrl, '_blank', 'noopener');
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível abrir o PDF agora.'));
        } finally {
            setBusy(false);
        }
    };
    return (
        <span className="inline-flex flex-col items-end gap-1">
            <OsButton variant="secondary" disabled={busy} onClick={() => void open()}>{busy ? 'Abrindo…' : label}</OsButton>
            {error ? <span role="alert" className="text-[12px] text-brand-red-600 dark:text-brand-red-400">{error}</span> : null}
        </span>
    );
};

export default FiscalPdfButton;
