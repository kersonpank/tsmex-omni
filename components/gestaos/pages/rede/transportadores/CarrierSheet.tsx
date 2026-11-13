import React, { useState } from 'react';
import { linksApi } from '../../../../../lib/api';
import type { Link } from '../../../../../types/index';
import type { CarrierRegistry, RegistryDriver, RegistryUnit } from '../../../../os/lib/carrier';
import { APPROVAL_LABEL, carrierTypeLabel } from '../../../lib/redeCarriers';
import { pendingItems, type PendingTarget } from '../../../lib/redeFrota';
import { useResource } from '../../../lib/resource';
import { Button, ErrorState, Kv, Loadable, ModeBadge, Pill, Skeleton } from '../../../ui/kit';
import { Drawer, useAction } from '../../../ui/overlay';
import { CarrierDataForm } from './CarrierDataForm';
import { DriverForm, LinkDriverPicker } from './DriverForm';
import { UnitForm } from './UnitForm';

type View =
    | { kind: 'ficha' }
    | { kind: 'carrier' }
    | { kind: 'unit'; role: 'TRACTION' | 'TRAILER'; plate: string | null }
    | { kind: 'driver'; id: string | null };

const Status: React.FC<{ issues: string[] }> = ({ issues }) => (issues.length ? <Pill tone="red">{issues.length} pendência(s)</Pill> : <Pill>Completo</Pill>);

const RowButton: React.FC<{ onClick: () => void; title: string; issues: string[]; disabled?: boolean }> = ({ onClick, title, issues, disabled }) => (
    <button type="button" onClick={onClick} disabled={disabled} className="gx-inset flex w-full items-start justify-between gap-3 p-3 text-left">
        <span className="min-w-0">
            <span className="block font-semibold">{title}</span>
            {issues.length ? <span className="gx-muted block text-[13px]">Falta: {issues.join(', ')}</span> : null}
        </span>
        <Status issues={issues} />
    </button>
);

/** Ficha do transportador numa gaveta só: as telas de editar trocam o conteúdo (nunca gaveta sobre gaveta). */
export const CarrierSheet: React.FC<{ link: Link; onClose: () => void }> = ({ link, onClose }) => {
    const registry = useResource<CarrierRegistry>(`links:registry:${link.id}`, async () => (await linksApi.registry(link.id)).data, { staleMs: 10_000 });
    const [view, setView] = useState<View>({ kind: 'ficha' });
    const { busy, run } = useAction();
    const back = () => setView({ kind: 'ficha' });
    const done = () => {
        registry.reload();
        back();
    };

    const invite = async () => {
        await run(
            'invite',
            async () => {
                const response = await linksApi.invite(link.id);
                const url = `${window.location.origin}/#/claim-link?token=${encodeURIComponent(response.data.token)}`;
                await navigator.clipboard.writeText(url);
            },
            { success: 'Convite copiado. Envie ao transportador; expira em 7 dias.', error: 'Não foi possível gerar o convite.' },
        );
    };

    const go = (target: PendingTarget, data: CarrierRegistry) => {
        if (target.kind === 'carrier') setView({ kind: 'carrier' });
        else if (target.kind === 'new-unit') setView({ kind: 'unit', role: 'TRACTION', plate: null });
        else if (target.kind === 'unit') setView({ kind: 'unit', role: data.units.find((u) => u.plate === target.plate)?.role ?? 'TRACTION', plate: target.plate });
        else if (target.kind === 'driver') setView({ kind: 'driver', id: target.id });
        else setView({ kind: 'driver', id: null });
    };

    const renderFicha = (data: CarrierRegistry) => {
        const pending = pendingItems(data);
        const traction = data.units.find((u) => u.role === 'TRACTION') ?? null;
        const trailers = data.units.filter((u) => u.role === 'TRAILER');
        const edit = data.canEdit;
        return (
            <div className="flex flex-col gap-6">
                <section className="gx-inset flex flex-col gap-3 p-4" aria-label="Falta para rodar com CIOT e MDF-e">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="gx-h2">Falta para rodar com CIOT e MDF-e</h3>
                        <ModeBadge mode="copilot" />
                    </div>
                    {pending.length === 0 ? (
                        <p className="text-[14px]">Cadastro padrão completo: nada falta no servidor.</p>
                    ) : (
                        <ul className="flex flex-col gap-2">
                            {pending.map((item) => (
                                <li key={item.key} className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="min-w-0 text-[14px]">
                                        <span className="font-semibold">{item.label}</span> <span className="gx-muted">falta {item.issues.join(', ')}</span>
                                    </span>
                                    {edit ? <Button size="sm" variant="soft" onClick={() => go(item.target, data)}>Resolver</Button> : null}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                {!edit ? <p className="gx-muted text-[13px]">Cadastrado por outro hub: somente leitura.</p> : null}

                <section className="flex flex-col gap-3">
                    <h3 className="gx-h2">Dados do transportador</h3>
                    <RowButton title="Dados e endereço" issues={data.carrierIssues} disabled={!edit} onClick={() => setView({ kind: 'carrier' })} />
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                        <Kv label="Documento" value={data.link.document} mono />
                        <Kv label="Telefone" value={data.link.phone || '—'} />
                        <Kv label="Tipo" value={carrierTypeLabel(data.link.carrierType as never)} />
                    </div>
                </section>

                <section className="flex flex-col gap-3">
                    <h3 className="gx-h2">Veículos (cada placa)</h3>
                    {data.units.map((u: RegistryUnit) => (
                        <RowButton key={u.plate} title={`${u.plate} · ${u.role === 'TRACTION' ? 'cavalo' : 'reboque'}`} issues={u.issues} disabled={!edit} onClick={() => setView({ kind: 'unit', role: u.role, plate: u.plate })} />
                    ))}
                    {data.units.length === 0 ? <p className="gx-muted text-[14px]">Nenhum veículo cadastrado.</p> : null}
                    {edit ? (
                        <div className="flex flex-wrap gap-2">
                            {!traction ? <Button variant="soft" onClick={() => setView({ kind: 'unit', role: 'TRACTION', plate: null })}>Cadastrar cavalo / veículo</Button> : null}
                            {traction && trailers.length < 3 ? <Button variant="soft" onClick={() => setView({ kind: 'unit', role: 'TRAILER', plate: null })}>Adicionar reboque</Button> : null}
                        </div>
                    ) : null}
                </section>

                <section className="flex flex-col gap-3">
                    <h3 className="gx-h2">Motoristas</h3>
                    {data.drivers.map((d: RegistryDriver) => (
                        <RowButton key={d.id} title={d.name} issues={d.issues} disabled={!edit} onClick={() => setView({ kind: 'driver', id: d.id })} />
                    ))}
                    {data.drivers.length === 0 ? <p className="gx-muted text-[14px]">Nenhum motorista: obrigatório para CIOT e MDF-e.</p> : null}
                    {edit ? (
                        <>
                            <div>
                                <Button variant="soft" onClick={() => setView({ kind: 'driver', id: null })}>Novo motorista</Button>
                            </div>
                            <LinkDriverPicker linkId={link.id} onDone={() => registry.reload()} />
                        </>
                    ) : null}
                </section>
            </div>
        );
    };

    const body = (data: CarrierRegistry) => {
        if (view.kind === 'carrier') return <CarrierDataForm link={link} registry={data} onDone={done} onCancel={back} />;
        if (view.kind === 'unit') return <UnitForm registry={data} role={view.role} unit={data.units.find((u) => u.plate === view.plate) ?? null} onDone={done} onCancel={back} />;
        if (view.kind === 'driver') return <DriverForm linkId={link.id} driver={data.drivers.find((d) => d.id === view.id) ?? null} onDone={done} onCancel={back} />;
        return renderFicha(data);
    };

    const canInvite = link.approvalStatus === 'APPROVED' && !link.userId;
    return (
        <Drawer
            open
            onClose={onClose}
            width={860}
            title={link.name}
            subtitle={<span className="gx-mono">{link.document}</span>}
            badge={<Pill tone={link.approvalStatus === 'APPROVED' ? 'neutral' : link.approvalStatus === 'REJECTED' ? 'red' : 'yellow'}>{APPROVAL_LABEL[link.approvalStatus]}</Pill>}
            footer={
                view.kind === 'ficha' ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="gx-muted text-[13px]">Operação física (viagem, CIOT, MDF-e) continua no hub.</span>
                        <div className="flex gap-2">
                            {canInvite ? <Button onClick={invite} loading={busy === 'invite'}>Copiar convite de acesso</Button> : null}
                            <Button onClick={onClose}>Fechar</Button>
                        </div>
                    </div>
                ) : undefined
            }
        >
            {registry.data ? (
                <>
                    {registry.error ? <ErrorState className="mb-3" message={registry.error} onRetry={registry.reload} /> : null}
                    {body(registry.data)}
                </>
            ) : (
                <Loadable state={registry} skeleton={<Skeleton rows={5} />}>{(data) => body(data)}</Loadable>
            )}
        </Drawer>
    );
};
