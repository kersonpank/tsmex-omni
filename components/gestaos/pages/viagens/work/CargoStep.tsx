import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatApiError, hubCargoApi, manifestsApi, ordersApi } from '../../../../../lib/api';
import type { ConsolidationQueueGroup, FreightDocState, ResolvedOrderSummary } from '../../../../../types/index';
import { docBadge, orderLabel } from '../../../../os/lib/readiness';
import { kg, money } from '../../../lib/format';
import { useResource } from '../../../lib/resource';
import { occupancyPct } from '../../../lib/viagemWork';
import { ConfirmButton, FormSection } from '../../../ui/form';
import { Button, Field, Kv, Loadable, Pill, Progress, Skeleton, TextInput } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { Blocked } from './Blocked';
import { refreshTrip, type StepProps } from './types';

const volume = (value: number | null | undefined) => (value != null ? `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m³` : '—');

/** Etapa 2: carga. Incluir e retirar pedidos, e a fila de consolidação do hub (sugestão do sistema). */
export const CargoStep: React.FC<StepProps> = ({ trip, perms }) => {
    const { busy, run } = useAction();
    const [code, setCode] = useState('');
    const [candidates, setCandidates] = useState<ResolvedOrderSummary[]>([]);
    const [notFound, setNotFound] = useState(false);
    const [looking, setLooking] = useState(false);
    const [lookError, setLookError] = useState<string | null>(null);
    const resolving = useRef(false);
    const editable = perms.editPlanning.allowed;
    const demands = trip.demands ?? [];
    const weight = occupancyPct(trip.totalWeight, trip.vehicleType?.maxWeight);
    const vol = occupancyPct(trip.totalVolume, trip.vehicleType?.maxVolume);
    const queues = useResource<ConsolidationQueueGroup[]>(trip.hubId && editable ? `manifest:queues:${trip.hubId}` : null, async () => (await hubCargoApi.queues(trip.hubId)).data ?? [], { staleMs: 30_000 });
    const legDoc = new Map<string, FreightDocState | undefined>((trip.legs ?? []).map((leg) => [leg.orderId, leg.order?.freightDocState]));
    const inTrip = new Set(demands.map((demand) => demand.order?.id).filter(Boolean));

    const add = async (orderId: string) => {
        const ok = await run(`add:${orderId}`, () => manifestsApi.addDemand(trip.id, { orderId }), { success: 'Pedido incluído na viagem.', error: 'Não foi possível incluir o pedido.' });
        if (ok) {
            setCandidates([]);
            refreshTrip();
        }
        return ok;
    };

    const resolveAndAdd = async () => {
        const text = code.trim();
        if (!text || resolving.current) return;
        resolving.current = true;
        setLooking(true);
        setNotFound(false);
        setLookError(null);
        try {
            const result = await ordersApi.resolve(text, trip.id);
            if (result.match === 'single') {
                if (await add(result.order.id)) setCode('');
            } else if (result.match === 'multiple') setCandidates(result.candidates);
            else setNotFound(true);
        } catch (error) {
            setLookError(`Não foi possível buscar o pedido. ${formatApiError(error)}`);
        } finally {
            resolving.current = false;
            setLooking(false);
        }
    };

    const remove = async (demandId: string) => {
        const ok = await run(`del:${demandId}`, () => manifestsApi.removeDemand(trip.id, demandId), { success: 'Pedido retirado da viagem.', error: 'Não foi possível retirar o pedido.' });
        if (ok) refreshTrip();
        return ok;
    };

    return (
        <div className="flex flex-col gap-2">
            <Blocked reason={perms.editPlanning.reason} className="mb-3" />
            <FormSection title="Resumo da carga" cols={1}>
                <div className="gx-inset px-4 py-3">
                    <Kv label="Pedidos" value={demands.length} />
                    <Kv label="Peso" value={kg(trip.totalWeight)} />
                    <Kv label="Volume" value={volume(trip.totalVolume)} />
                    <Kv label="Valor das notas" value={money(trip.totalValue)} />
                    <Kv label={`Ocupação de peso${trip.vehicleType ? ` (${trip.vehicleType.name})` : ''}`} value={weight != null ? <span className="flex items-center gap-2"><Progress className="w-24" value={weight} tone={weight > 100 ? 'red' : 'royal'} label="Peso" />{weight}%</span> : 'sem capacidade cadastrada'} />
                    <Kv label="Ocupação de volume" value={vol != null ? `${vol}%` : 'sem capacidade cadastrada'} />
                </div>
                {(weight != null && weight > 100) || (vol != null && vol > 100) ? <p className="gx-red-text text-[13.5px] font-semibold">A carga passa da capacidade do veículo.</p> : null}
            </FormSection>

            <FormSection title={`Pedidos da viagem (${demands.length})`} cols={1}>
                {demands.length === 0 ? <p className="gx-muted text-[13.5px]">Nenhum pedido ainda. Inclua pela busca ou pela fila do hub abaixo.</p> : null}
                <ul className="flex flex-col">
                    {demands.map((demand) => {
                        const badge = docBadge(legDoc.get(demand.order?.id ?? ''));
                        return (
                            <li key={demand.id} className="gx-hair-b flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 last:border-b-0">
                                <span className="min-w-0">
                                    {demand.order?.id ? (
                                        <Link className="font-semibold hover:underline" to={`/gestaos/pedidos?p=${demand.order.id}`}>
                                            {orderLabel({ nfNumber: demand.nfNumber, demand: { orderNumber: demand.orderNumber } })}
                                        </Link>
                                    ) : (
                                        <span className="font-semibold">Pedido {demand.orderNumber}</span>
                                    )}
                                    <span className="gx-soft block truncate text-[13px]">{demand.destination}</span>
                                    <span className="gx-muted text-[12.5px]">
                                        {kg(demand.weight)} · {volume(demand.volume)} · {money(demand.nfValue)}
                                    </span>
                                </span>
                                <span className="flex items-center gap-2">
                                    <Pill tone={badge.tone === 'ok' ? 'royal' : badge.tone === 'bad' ? 'red' : 'neutral'}>{badge.label}</Pill>
                                    {editable ? <ConfirmButton label="Retirar" confirmLabel="Retirar?" onConfirm={() => remove(demand.id)} /> : null}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </FormSection>

            {editable ? (
                <>
                    <FormSection title="Incluir pedido" hint="Número do pedido ou chave da NF-e." cols={1}>
                        <Field label="Pedido ou chave da NF-e">
                            <div className="flex gap-2">
                                <TextInput
                                    aria-label="Número do pedido ou chave da NF-e"
                                    value={code}
                                    onChange={(event) => setCode(event.target.value)}
                                    onKeyDown={(event) => event.key === 'Enter' && void resolveAndAdd()}
                                    inputMode="search"
                                />
                                <Button variant="primary" disabled={!code.trim()} loading={looking} onClick={() => void resolveAndAdd()}>
                                    Incluir
                                </Button>
                            </div>
                        </Field>
                        {lookError ? <p className="gx-red-text text-[13.5px] font-semibold" role="alert">{lookError}</p> : null}
                        {notFound ? <p className="gx-red-text text-[13.5px] font-semibold" role="alert">Nenhum pedido encontrado para este número ou chave.</p> : null}
                        {candidates.length ? (
                            <div className="flex flex-col gap-2">
                                <p className="gx-soft text-[13px]">Mais de um pedido encontrado. Escolha o correto:</p>
                                {candidates.map((candidate) => (
                                    <Button key={candidate.id} className="justify-between" loading={busy === `add:${candidate.id}`} onClick={() => void add(candidate.id)}>
                                        {orderLabel({ nfNumber: candidate.nfNumber, demand: { orderNumber: candidate.orderNumber } }, candidate.id)} · {candidate.destination ?? 'sem destino'}
                                    </Button>
                                ))}
                            </div>
                        ) : null}
                    </FormSection>

                    <FormSection title="Fila de consolidação do hub" hint="O sistema agrupa a carga parada no hub por próximo destino. Você decide o que entra." mode="copilot" cols={1}>
                        {!trip.hubId ? (
                            <p className="gx-muted text-[13.5px]">Esta viagem não tem hub responsável; a fila não se aplica.</p>
                        ) : (
                            <Loadable state={queues} skeleton={<Skeleton rows={2} />}>
                                {(groups) => {
                                    const sorted = groups.slice().sort((a, b) => Number(b.destHubId === trip.destHubId) - Number(a.destHubId === trip.destHubId));
                                    const list = sorted.map((group) => ({ group, orders: group.orders.filter((order) => !inTrip.has(order.orderId)) })).filter((item) => item.orders.length > 0);
                                    if (!list.length) return <p className="gx-muted text-[13.5px]">Nenhum pedido esperando na fila do hub.</p>;
                                    return (
                                        <div className="flex flex-col gap-3">
                                            {list.map(({ group, orders }) => (
                                                <div key={group.key} className="gx-inset px-4 py-3">
                                                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                                                        {group.destHubName ?? (group.kind === 'LOCAL' ? 'Entrega local' : 'Sem rota definida')}
                                                        {group.destHubId && group.destHubId === trip.destHubId ? <Pill tone="royal">Mesmo destino da viagem</Pill> : null}
                                                    </p>
                                                    <p className="gx-muted text-[12.5px]">
                                                        {orders.length} {orders.length === 1 ? 'pedido' : 'pedidos'} · {kg(group.totalWeightKg)}
                                                    </p>
                                                    <ul className="mt-2 flex flex-col">
                                                        {orders.map((order) => (
                                                            <li key={order.orderId} className="gx-hair-b flex flex-wrap items-center justify-between gap-2 py-2 last:border-b-0">
                                                                <span className="min-w-0 text-[13.5px]">
                                                                    <span className="font-medium">{orderLabel({ nfNumber: order.nfNumber, demand: { orderNumber: order.orderNumber } }, order.orderId)}</span>
                                                                    <span className="gx-muted block truncate text-[12.5px]">
                                                                        {order.destination ?? 'sem destino'} · {kg(order.weightKg)}
                                                                    </span>
                                                                </span>
                                                                <Button size="sm" loading={busy === `add:${order.orderId}`} onClick={() => void add(order.orderId)}>
                                                                    Incluir
                                                                </Button>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                }}
                            </Loadable>
                        )}
                    </FormSection>
                </>
            ) : null}
        </div>
    );
};
