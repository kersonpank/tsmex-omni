import React from 'react';
import type { ManifestFiscalDocument } from '../../../../types/index';
import { printableFiscalDocuments } from '../../lib/mdfe';
import { OsBadge, OsCard } from '../../ui/kit';
import FiscalPdfButton from './FiscalPdfButton';

/** Documentos fiscais já autorizados (ou encerrados) da viagem, com o PDF — durante e depois da viagem, também para o hub que recebe. */
const TripFiscalDocuments: React.FC<{ manifest: { id: string; fiscalDocuments?: ManifestFiscalDocument[] } }> = ({ manifest }) => {
    const items = printableFiscalDocuments(manifest.fiscalDocuments);
    if (items.length === 0) return null;
    return (
        <OsCard className="mb-4 !p-3.5">
            <p className="mb-2 font-display text-[15px] font-bold text-tower-900 dark:text-white">Documentos fiscais</p>
            <div className="flex flex-col gap-2">
                {items.map(({ doc, label }) => (
                    <div key={doc.id} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="truncate text-[14px] font-semibold text-tower-900 dark:text-white">{label}</p>
                            <OsBadge tone={doc.status === 'CLOSED' ? 'neutral' : 'ok'}>{doc.status === 'CLOSED' ? 'encerrado' : 'autorizado'}</OsBadge>
                        </div>
                        <FiscalPdfButton manifestId={manifest.id} documentId={doc.id} />
                    </div>
                ))}
            </div>
        </OsCard>
    );
};

export default TripFiscalDocuments;
