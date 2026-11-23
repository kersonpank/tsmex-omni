import React from 'react';
import { useNavigate } from 'react-router-dom';
import { manifestsApi } from '../../../../../lib/api';
import { deleteDraftPermission } from '../../../lib/viagemFiscal';
import { ConfirmButton } from '../../../ui/form';
import { useAction } from '../../../ui/overlay';
import { Blocked } from './Blocked';
import { refreshTrip, type StepProps } from './types';

/** Excluir rascunho vazio: só com a viagem em montagem, sem pedido, documento, Carta Frete nem oferta anterior. */
export const DeleteDraft: React.FC<Pick<StepProps, 'trip' | 'readiness'>> = ({ trip, readiness }) => {
    const { busy, run } = useAction();
    const navigate = useNavigate();
    if (trip.status !== 'DRAFT') return null;
    const permission = deleteDraftPermission(trip, readiness);
    const remove = async () => {
        const ok = await run('delete-draft', () => manifestsApi.deleteEmpty(trip.id), { success: 'Rascunho vazio excluído.', error: 'Não foi possível excluir o rascunho.' });
        if (ok) {
            refreshTrip();
            navigate('/gestaos/viagens', { replace: true });
        }
        return ok;
    };
    return permission.allowed ? (
        <ConfirmButton label="Excluir rascunho vazio" confirmLabel="Excluir definitivamente" variant="soft" loading={busy === 'delete-draft'} onConfirm={remove} />
    ) : (
        <Blocked reason={`Excluir: ${permission.reason}`} />
    );
};
