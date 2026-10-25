import React from 'react';
import type { TripGroup } from '../../lib/trip';
import { OsBadge } from '../../ui/kit';
import OsSheet from '../../ui/Sheet';
import TripRegistryEditor from './TripRegistryEditor';

/**
 * Grupos sem formulário próprio no O.S.: cadastro, carga e rota.
 * Cadastro abre as unidades e motoristas da viagem. Documentos fiscais têm a folha própria TripDocumentsSheet.
 */

const TripInfoEditor: React.FC<{
    manifestId: string;
    linkId?: string | null;
    group: TripGroup;
    onClose: () => void;
    onUpdated?: () => void | Promise<void>;
}> = ({ manifestId, group, onClose, onUpdated }) => {
    if (group.key === 'registry') return <TripRegistryEditor manifestId={manifestId} onClose={onClose} onUpdated={onUpdated} />;
    const all = [...group.blocking, ...group.warnings];

    return (
        <OsSheet title={group.title} onClose={onClose}>
            <ul className="flex flex-col gap-2">
                {all.map((issue, i) => (
                    <li key={`${issue.code}-${issue.field ?? i}`} className="flex items-start gap-2 rounded-xl border border-tower-200 p-3 dark:border-tower-700">
                        <OsBadge tone={issue.severity === 'blocking' ? 'bad' : 'warn'}>
                            {issue.severity === 'blocking' ? 'bloqueia' : 'aviso'}
                        </OsBadge>
                        <span className="text-[13px] leading-snug text-tower-700 dark:text-tower-200">{issue.message}</span>
                    </li>
                ))}
            </ul>

            <div className="mt-4 flex flex-col gap-2">
                {group.key === 'cargo' ? (
                    <p className="text-[13px] text-tower-500 dark:text-tower-300">
                        Adicione pedidos montando a viagem a partir da fila em Viagens.
                    </p>
                ) : null}
            </div>
        </OsSheet>
    );
};

export default TripInfoEditor;
