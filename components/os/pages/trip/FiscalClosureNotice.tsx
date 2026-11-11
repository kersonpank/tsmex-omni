import React, { useState } from 'react';
import { manifestsApi } from '../../../../lib/api';
import type { ManifestFiscalDocument } from '../../../../types/index';
import { OsButton, OsErrorNotice } from '../../ui/kit';
import { apiErrorMessage } from '../../ui/Sheet';

/** CIOT/MDF-e de uma viagem concluída que continuam AUTHORIZED (não encerrados). */
export function openFiscalDocuments(manifest: { status: string; fiscalDocuments?: ManifestFiscalDocument[] }): ManifestFiscalDocument[] {
    if (manifest.status !== 'COMPLETED') return [];
    return (manifest.fiscalDocuments ?? []).filter((doc) => doc.status === 'AUTHORIZED' && (doc.documentType === 'MDFE' || doc.documentType === 'CIOT'));
}

/** Aviso + ação "Encerrar documentos" para quando o encerramento automático da viagem não fechou tudo. */
const FiscalClosureNotice: React.FC<{
    manifest: { id: string; status: string; fiscalDocuments?: ManifestFiscalDocument[] };
    onDone: () => void | Promise<void>;
}> = ({ manifest, onDone }) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const open = openFiscalDocuments(manifest);
    if (open.length === 0) return null;
    const hasMdfe = open.some((doc) => doc.documentType === 'MDFE');
    const hasCiot = open.some((doc) => doc.documentType === 'CIOT');

    const close = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
            const result = await manifestsApi.retryFiscalClosure(manifest.id);
            setMessage(result.message ?? 'Encerramento reenfileirado.');
            await onDone();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível encerrar os documentos.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section aria-label="Documentos ainda abertos" className="mb-4 rounded-xl border-2 border-brand-yellow-400 bg-brand-yellow-50 p-3.5 dark:bg-tower-800">
            <p className="font-display text-[15px] font-bold text-tower-900 dark:text-white">Documentos ainda abertos</p>
            {hasMdfe ? <p className="mt-1 text-[13px] text-tower-700 dark:text-tower-200">MDF-e ainda aberto na SEFAZ: sem encerrar, o veículo não emite outro.</p> : null}
            {hasCiot ? <p className="mt-1 text-[13px] text-tower-700 dark:text-tower-200">CIOT ainda aberto na e-Frete: encerre para liberar o pagamento do transportador.</p> : null}
            {error ? <div className="mt-2" role="alert"><OsErrorNotice message={error} /></div> : null}
            {message ? <p className="mt-2 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300" role="status">{message}</p> : null}
            <div className="mt-2.5">
                <OsButton full disabled={busy} onClick={() => void close()}>{busy ? 'Encerrando…' : 'Encerrar documentos'}</OsButton>
            </div>
        </section>
    );
};

export default FiscalClosureNotice;
