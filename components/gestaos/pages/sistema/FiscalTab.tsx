import React, { useMemo, useState } from 'react';
import { fiscalDistribuicaoApi, fiscalEmittersApi, nfeDistribuicaoMonitorApi, nfeDistribuicaoTriagemApi } from '../../../../lib/api';
import type { NfeDistribuicaoMonitorDocumento } from '../../../../lib/api';
import type { FiscalEmitter } from '../../../../types/index';
import { relative } from '../../lib/format';
import { ENVIRONMENT_LABEL, certificateView, sortEmitters } from '../../lib/sistema';
import { invalidate, useResource, type UseResourceResult } from '../../lib/resource';
import { ConfirmButton, formatCnpjCpf } from '../../ui/form';
import { Button, EmptyState, Loadable, Panel, Pill, Skeleton } from '../../ui/kit';
import { useAction } from '../../ui/overlay';
import { EmitterDrawer } from './EmitterDrawer';
import { QueueHealth } from './QueueHealth';

const emitterName = (e: FiscalEmitter) => e.displayName || e.tradeName || e.person?.tradeName || e.person?.legalName || 'Emitente sem nome';

const EmittersPanel = ({ onEdit, state }: { onEdit: (emitter: FiscalEmitter | null) => void; state: UseResourceResult<FiscalEmitter[]> }) => {
    const sorted = useMemo(() => sortEmitters(state.data ?? []), [state.data]);
    return (
        <Panel
            title="Emitentes fiscais"
            hint="Quem emite CT-e e MDF-e, em qual ambiente e se o cadastro está pronto."
            mode="manual"
            actions={<Button variant="primary" size="sm" onClick={() => onEdit(null)}>Novo emitente</Button>}
        >
            <Loadable state={state} skeleton={<Skeleton rows={3} height={56} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="Nenhum emitente cadastrado." hint="Cadastre o CNPJ que emite os documentos fiscais." />}>
                {() => (
                    <ul>
                        {sorted.map((emitter) => {
                            const cert = certificateView(emitter);
                            const pending = emitter.readiness?.issues?.length ?? 0;
                            return (
                                <li key={emitter.id} className="gx-hair-b flex flex-wrap items-center gap-x-4 gap-y-3 py-3.5 last:border-b-0">
                                    <div className="min-w-0 flex-1 basis-56">
                                        <p className="truncate font-semibold">{emitterName(emitter)}</p>
                                        <p className="gx-muted text-[12.5px]"><span className="gx-mono">{formatCnpjCpf(emitter.person?.document)}</span> · {emitter.active ? 'Ativo' : 'Inativo'}</p>
                                    </div>
                                    <Pill tone={emitter.environment === 'PRODUCAO' ? 'solid' : 'yellow'} title="Ambiente de CT-e e MDF-e">{ENVIRONMENT_LABEL[emitter.environment]}</Pill>
                                    <Pill tone={cert.tone} dot title={cert.detail}>{cert.label}</Pill>
                                    <Pill tone={pending === 0 ? 'neutral' : 'yellow'} dot>{pending === 0 ? 'Cadastro pronto' : `${pending} ${pending === 1 ? 'pendência' : 'pendências'}`}</Pill>
                                    <Button size="sm" variant="soft" onClick={() => onEdit(emitter)} aria-label={`Editar emitente ${emitterName(emitter)}`}>Editar</Button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Loadable>
        </Panel>
    );
};

function useEmitters() {
    return useResource<FiscalEmitter[]>('system:emitters', async () => (await fiscalEmittersApi.list()).data ?? [], { staleMs: 30_000 });
}

const NfeTriagePanel: React.FC<{ emitters: FiscalEmitter[] }> = ({ emitters }) => {
    const { busy, run } = useAction();
    const state = useResource<NfeDistribuicaoMonitorDocumento[]>('system:nfe-triage', async () => (await nfeDistribuicaoMonitorApi.list({ status: 'READY_FOR_TRIAGE' })).data?.documentos ?? [], { refreshMs: 120_000 });
    const eligible = emitters.filter((e) => e.active && e.distribuicaoNfeEnabled && e.distribuicaoNfeCheckpoint?.seeded !== false);

    const convert = async (doc: NfeDistribuicaoMonitorDocumento) => {
        const ok = await run(`convert:${doc.id}`, () => nfeDistribuicaoTriagemApi.converter(doc.id), { success: 'NF-e convertida em demanda.', error: 'Não foi possível converter a NF-e.' });
        if (ok) invalidate('system:nfe', 'demands:', 'summary');
    };
    const discard = async (doc: NfeDistribuicaoMonitorDocumento) => {
        const ok = await run(`discard:${doc.id}`, () => nfeDistribuicaoTriagemApi.descartar(doc.id), { success: 'NF-e descartada.', error: 'Não foi possível descartar a NF-e.' });
        if (ok) invalidate('system:nfe');
        return ok;
    };
    const sync = async (emitter: FiscalEmitter) => {
        const ok = await run(`sync:${emitter.id}`, () => fiscalDistribuicaoApi.syncNow(emitter.id), { success: 'Varredura pedida. As notas aparecem aqui em instantes.', error: 'Não foi possível pedir a varredura.' });
        if (ok) invalidate('system:nfe');
    };

    return (
        <Panel
            title="NF-e para triar"
            hint="Notas destinadas aos seus CNPJs que o sistema encontrou na SEFAZ. Converta em demanda ou descarte."
            mode="auto"
            count={state.data?.length ?? null}
            countTone="yellow"
            actions={
                <div className="flex flex-wrap gap-2">
                    {eligible.map((e) => (
                        <Button key={e.id} size="sm" variant="soft" loading={busy === `sync:${e.id}`} disabled={Boolean(busy)} onClick={() => void sync(e)} aria-label={`Buscar agora ${emitterName(e)}`}>
                            Buscar agora{eligible.length > 1 ? ` · ${emitterName(e)}` : ''}
                        </Button>
                    ))}
                </div>
            }
        >
            <Loadable state={state} skeleton={<Skeleton rows={3} height={56} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="Nenhuma NF-e esperando triagem." hint="A busca roda sozinha duas vezes ao dia nos emitentes com a distribuição ligada." />}>
                {(docs) => (
                    <ul>
                        {docs.map((doc) => (
                            <li key={doc.id} className="gx-hair-b flex flex-wrap items-center gap-x-4 gap-y-3 py-3.5 last:border-b-0">
                                <div className="min-w-0 flex-1 basis-64">
                                    <p className="gx-mono truncate text-[13px]">{doc.accessKey}</p>
                                    <p className="gx-muted text-[12.5px]">Emitida por {formatCnpjCpf(doc.cnpjEmitente)} · para {doc.fiscalEmitter.displayName ?? 'emitente'} · {relative(doc.createdAt)}</p>
                                </div>
                                <Button size="sm" variant="primary" loading={busy === `convert:${doc.id}`} disabled={Boolean(busy)} onClick={() => void convert(doc)} aria-label={`Converter NF-e ${doc.accessKey}`}>
                                    Converter em demanda
                                </Button>
                                <ConfirmButton label="Descartar" confirmLabel="Descartar NF-e?" variant="ghost" disabled={Boolean(busy)} onConfirm={() => discard(doc)} />
                            </li>
                        ))}
                    </ul>
                )}
            </Loadable>
        </Panel>
    );
};

export const FiscalTab: React.FC = () => {
    const emitters = useEmitters();
    const [open, setOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const editing = (emitters.data ?? []).find((e) => e.id === editingId) ?? null;
    return (
        <div className="gx-stagger flex flex-col gap-6">
            <EmittersPanel
                state={emitters}
                onEdit={(emitter) => {
                    setEditingId(emitter?.id ?? null);
                    setOpen(true);
                }}
            />
            <NfeTriagePanel emitters={emitters.data ?? []} />
            <QueueHealth />
            <EmitterDrawer open={open} emitter={editing} onClose={() => setOpen(false)} />
        </div>
    );
};
