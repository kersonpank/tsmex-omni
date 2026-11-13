import React from 'react';
import { api } from '../../../../lib/api';
import { QUEUE_COUNT_LABEL, type CteQueueStatus } from '../../lib/sistema';
import { num } from '../../lib/format';
import { invalidate, useResource } from '../../lib/resource';
import { Button, Loadable, ModeBadge, Panel, Pill } from '../../ui/kit';
import { useAction } from '../../ui/overlay';

const KEY = 'system:cte-queue';

/** Fila de emissão de CT-e: mostra se a máquina anda e, se parou, devolve o botão a quem decide. */
export const QueueHealth: React.FC = () => {
    const state = useResource<CteQueueStatus>(
        KEY,
        async () => (await api.get<{ success: boolean; data: CteQueueStatus }>('/system-alerts/cte-queue-status')).data.data,
        { refreshMs: 30_000 },
    );
    const { busy, run } = useAction();

    const resume = async () => {
        const ok = await run('resume', () => api.post('/system-alerts/cte-queue/resume'), {
            success: 'Fila de CT-e retomada.',
            error: 'Não foi possível retomar a fila.',
        });
        if (ok) invalidate(KEY);
    };

    return (
        <Panel title="Fila de CT-e" hint="Emissão de documentos de transporte na SEFAZ." mode="auto">
            <Loadable state={state}>
                {(data) => (
                    <>
                        <div className="flex flex-wrap items-center gap-3">
                            <Pill tone={data.paused ? 'red' : 'royal'} dot>
                                {data.paused ? 'Pausada' : 'Rodando'}
                            </Pill>
                            <span className="gx-muted text-[13px]">{data.paused ? 'Nenhum CT-e está sendo emitido agora.' : 'Emitindo normalmente.'}</span>
                        </div>
                        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {QUEUE_COUNT_LABEL.map(({ key, label }) => (
                                <div key={key} className="gx-inset px-3.5 py-3">
                                    <dt className="gx-label">{label}</dt>
                                    <dd className={`gx-num mt-1 text-[24px] ${key === 'failed' && data.counts[key] > 0 ? 'gx-red-text' : ''}`}>{num(data.counts[key])}</dd>
                                </div>
                            ))}
                        </dl>
                        {data.paused ? (
                            <div className="gx-inset mt-4 flex flex-wrap items-center gap-3 px-4 py-3.5">
                                <ModeBadge mode="copilot" />
                                <p className="min-w-0 flex-1 basis-56 text-[13.5px]">
                                    A fila para sozinha quando o emissor avisa que a cota acabou. Retome só depois de resolver a causa; os CT-e esperando seguem em ordem.
                                </p>
                                <Button variant="primary" size="sm" loading={busy === 'resume'} onClick={() => void resume()}>
                                    Retomar a fila
                                </Button>
                            </div>
                        ) : null}
                    </>
                )}
            </Loadable>
        </Panel>
    );
};
