import React, { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { manifestsApi } from '../../../../lib/api';
import type { Manifest, ManifestReadiness } from '../../../../types/index';
import type { ManifestWithLegs } from '../../../os/lib/arrival';
import { useResource } from '../../lib/resource';
import { kg, money } from '../../lib/format';
import { carrierLabel, platesLabel, tripCode, tripStage } from '../../lib/trips';
import { occupancyPct, parseStep, pendingByStep, tripPermissions, tripTitle, TRIP_STEPS, type TripStep } from '../../lib/viagemWork';
import { Loadable, PageHeader, Panel, Pill, Progress, Skeleton, Tabs } from '../../ui/kit';
import { CargoStep } from './work/CargoStep';
import { CarrierStep } from './work/CarrierStep';
import { CoverStep } from './work/CoverStep';
import { DocumentsStep } from './work/DocumentsStep';
import { ExecutionStep } from './work/ExecutionStep';
import { MissingPanel } from './work/MissingPanel';
import { RouteStep } from './work/RouteStep';
import type { StepProps } from './work/types';
import { TripCreateForm } from './TripCreateForm';

const Workspace: React.FC<{ manifestId: string }> = ({ manifestId }) => {
    const [params, setParams] = useSearchParams();
    const step = parseStep(params.get('etapa'));
    const tripState = useResource<ManifestWithLegs>(`manifest:${manifestId}`, async () => (await manifestsApi.getById(manifestId)).data as ManifestWithLegs, { staleMs: 5_000 });
    const readinessState = useResource<ManifestReadiness | null>(`manifest:readiness:${manifestId}`, async () => (await manifestsApi.readiness(manifestId)).data ?? null, { staleMs: 5_000 });
    const trip = tripState.data;
    const readiness = readinessState.data ?? null;
    const perms = useMemo(() => (trip ? tripPermissions(trip, readiness) : null), [trip, readiness]);
    const counts = useMemo(() => pendingByStep(readiness?.issues ?? []), [readiness]);
    const goto = (next: TripStep) =>
        setParams(
            (current) => {
                const copy = new URLSearchParams(current);
                copy.set('etapa', next);
                return copy;
            },
            { replace: true },
        );

    return (
        <Loadable state={tripState} skeleton={<Skeleton rows={6} />}>
            {(data: Manifest) => {
                const t = data as ManifestWithLegs;
                const stage = tripStage(t);
                const props: StepProps = { trip: t, readiness, perms: perms!, goto };
                const weight = occupancyPct(t.totalWeight, t.vehicleType?.maxWeight);
                const volume = occupancyPct(t.totalVolume, t.vehicleType?.maxVolume);
                return (
                    <>
                        <PageHeader
                            title={tripTitle(t)}
                            eyebrow={`Viagem ${tripCode(t)}`}
                            question="O que falta para esta viagem sair, e quem resolve cada coisa?"
                            actions={
                                <Link to={`/gestaos/viagens?v=${t.id}`} className="gx-btn gx-btn-ghost">
                                    Voltar às viagens
                                </Link>
                            }
                        />
                        <div className="gx-rise mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
                            <Pill tone={stage.tone}>{stage.label}</Pill>
                            <span className="gx-soft text-[14px]">{carrierLabel(t)}</span>
                            <span className="gx-mono text-[13.5px]">{platesLabel(t)}</span>
                            <span className="gx-soft text-[14px]">
                                {kg(t.totalWeight)} · {money(t.totalValue)}
                            </span>
                            {weight != null ? <Progress className="w-28" value={weight} tone={weight > 100 ? 'red' : 'royal'} label="Peso" /> : null}
                            {weight != null ? <span className="gx-muted text-[13px]">peso {weight}%{volume != null ? ` · volume ${volume}%` : ''}</span> : null}
                        </div>
                        <div className="grid gap-6 lg:grid-cols-12">
                            <div className="flex min-w-0 flex-col gap-5 lg:col-span-4">
                                <MissingPanel trip={t} readiness={readiness} loading={readinessState.loading && !readiness} error={readinessState.error} onGoto={goto} onReload={() => readinessState.reload()} />
                            </div>
                            <div className="flex min-w-0 flex-col gap-5 lg:col-span-8">
                                <Tabs
                                    label="Etapas da viagem"
                                    value={step}
                                    onChange={(id) => goto(id as TripStep)}
                                    tabs={TRIP_STEPS.map((item) => ({ id: item.id, label: item.label, count: counts[item.id] || null }))}
                                />
                                <Panel>
                                    {step === 'rota' ? <RouteStep {...props} /> : null}
                                    {step === 'carga' ? <CargoStep {...props} /> : null}
                                    {step === 'transportador' ? <CarrierStep {...props} /> : null}
                                    {step === 'capa' ? <CoverStep {...props} /> : null}
                                    {step === 'oferta' ? <ExecutionStep {...props} /> : null}
                                    {step === 'documentos' ? <DocumentsStep {...props} /> : null}
                                </Panel>
                            </div>
                        </div>
                    </>
                );
            }}
        </Loadable>
    );
};

/** Página de trabalho da viagem: `/gestaos/viagens/nova` cria o rascunho; `/gestaos/viagens/:id` monta e opera. */
const TripWorkPage: React.FC = () => {
    const { manifestId } = useParams<{ manifestId?: string }>();
    if (!manifestId) return <TripCreateForm />;
    return <Workspace key={manifestId} manifestId={manifestId} />;
};

export default TripWorkPage;
