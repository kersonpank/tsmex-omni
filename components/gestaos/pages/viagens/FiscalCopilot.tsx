import React, { useState } from 'react';
import axios from 'axios';
import { formatApiError, manifestsApi } from '../../../../lib/api';
import type { Manifest } from '../../../../types/index';
import { KEYS } from '../../lib/data';
import { invalidate } from '../../lib/resource';
import { openFiscalDocs } from '../../lib/trips';
import { DOC_TYPE_LABEL } from '../../lib/viagens';
import { IconCompass } from '../../ui/icons';
import { Button } from '../../ui/kit';
import { useToast } from '../../ui/overlay';

/**
 * Decisão do Copilot: documento aberto numa viagem concluída. O Autopilot já tenta encerrar sozinho
 * (com espera crescente); aqui a pessoa pede uma nova tentativa agora.
 */
export const FiscalCopilot: React.FC<{ trip: Manifest }> = ({ trip }) => {
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const [running, setRunning] = useState<string | null>(null);
    const open = openFiscalDocs(trip);
    if (!open.length) return null;

    const names = [...new Set(open.map((doc) => DOC_TYPE_LABEL[doc.documentType]))].join(' e ');

    const retry = async () => {
        if (busy) return;
        setBusy(true);
        setRunning(null);
        try {
            const result = await manifestsApi.retryFiscalClosure(trip.id);
            toast.success(result.message || 'Encerramento reenfileirado. O resultado aparece aqui em instantes.');
            invalidate(KEYS.manifests, KEYS.exceptions);
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 409) {
                // Já há uma tentativa rodando: não é falha, é o servidor dizendo para esperar.
                setRunning(formatApiError(error));
                invalidate(KEYS.manifests, KEYS.exceptions);
            } else {
                toast.error(`Não foi possível pedir o encerramento. ${formatApiError(error)}`);
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rounded-2xl px-4 py-3.5" style={{ background: 'var(--gx-royal-soft)', boxShadow: 'inset 0 0 0 1px var(--gx-royal-line)' }}>
            <p className="gx-label gx-royal-text flex items-center gap-1.5">
                <IconCompass size={14} /> Copilot sugere
            </p>
            <p className="mt-1.5 text-[16px] font-semibold leading-snug">
                {names} {open.length > 1 ? 'seguem abertos' : 'segue aberto'} depois da conclusão
            </p>
            <p className="gx-soft mt-1 max-w-[62ch] text-[13.5px]">
                Enquanto o documento fica aberto, a placa não consegue emitir um novo MDF-e. O encerramento automático repete sozinho; se quiser, peça uma nova tentativa agora.
            </p>
            {running ? (
                <p className="gx-yellow-text mt-2.5 text-[13.5px] font-semibold" role="status">
                    {running}
                </p>
            ) : null}
            <div className="mt-3">
                <Button variant="primary" size="sm" loading={busy} onClick={retry}>
                    Tentar encerrar de novo
                </Button>
            </div>
        </div>
    );
};
