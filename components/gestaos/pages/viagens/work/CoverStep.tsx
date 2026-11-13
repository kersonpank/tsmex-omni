import React, { useEffect, useState } from 'react';
import { manifestsApi } from '../../../../../lib/api';
import type { AnttFloor, ManifestFreightAgreement, TripPriceEstimate } from '../../../../../types/index';
import { ceilAnttCents, formatAnttFloor, formatAnttMoney, isBelowAnttFloor } from '../../../../os/lib/ciot';
import { money, pct } from '../../../lib/format';
import { useResource } from '../../../lib/resource';
import { marginView } from '../../../lib/viagens';
import { DateTimeInput, FormSection, MoneyInput } from '../../../ui/form';
import { Button, Field, Kv, ModeBadge, TextInput } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { FiscalEmitterSelect } from '../../../ui/pickers';
import { Blocked } from './Blocked';
import { refreshTrip, type StepProps } from './types';

const Cover: React.FC<StepProps> = ({ trip, perms }) => {
    const { busy, run } = useAction();
    const editable = perms.editCover.allowed;
    const electronic = trip.fiscalEmitter?.averbacaoProvider === 'ATM';
    const [emitterId, setEmitterId] = useState<string | null>(trip.fiscalEmitterId ?? null);
    const [departure, setDeparture] = useState<string | null>(trip.plannedDepartureAt ?? null);
    const [arrival, setArrival] = useState<string | null>(trip.plannedArrivalAt ?? null);
    const [seal, setSeal] = useState(trip.seloLacre ?? '');
    const [averbacao, setAverbacao] = useState(trip.cargoInsuranceAverbacao ?? '');
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        setEmitterId(trip.fiscalEmitterId ?? null);
        setDeparture(trip.plannedDepartureAt ?? null);
        setArrival(trip.plannedArrivalAt ?? null);
        setSeal(trip.seloLacre ?? '');
        setAverbacao(trip.cargoInsuranceAverbacao ?? '');
    }, [trip.updatedAt]);

    const save = async () => {
        if (departure && arrival && new Date(arrival).getTime() < new Date(departure).getTime()) {
            setError('A chegada prevista não pode ser antes da saída.');
            return;
        }
        setError(null);
        const body: Parameters<typeof manifestsApi.updateCapa>[1] = {};
        if (emitterId && emitterId !== trip.fiscalEmitterId) body.fiscalEmitterId = emitterId;
        if (departure) body.plannedDepartureAt = departure;
        if (arrival) body.plannedArrivalAt = arrival;
        if (seal.trim() !== (trip.seloLacre ?? '')) body.seloLacre = seal.trim();
        // Averbação eletrônica: o campo manual só segue se já havia um número.
        if (!electronic || averbacao.trim() || trip.cargoInsuranceAverbacao) body.cargoInsuranceAverbacao = averbacao.trim();
        const ok = await run('cover', () => manifestsApi.updateCapa(trip.id, body), { success: 'Capa da viagem salva.', error: 'Não foi possível salvar a capa.' });
        if (ok) refreshTrip();
    };

    return (
        <FormSection title="Capa da viagem" hint="Emitente dos documentos fiscais, datas previstas e lacre.">
            <Field label="Emitente fiscal" hint={trip.fiscalEmitterId ? 'Definido automaticamente quando o hub tem um padrão.' : undefined}>
                <FiscalEmitterSelect value={emitterId} hubId={trip.hubId} disabled={!editable} onChange={setEmitterId} />
            </Field>
            <Field label="Selo / lacre">
                <TextInput aria-label="Selo ou lacre" disabled={!editable} value={seal} onChange={(event) => setSeal(event.target.value)} />
            </Field>
            <Field label="Saída prevista" error={error}>
                <DateTimeInput aria-label="Saída prevista" disabled={!editable} value={departure} onChange={setDeparture} />
            </Field>
            <Field label="Chegada prevista (opcional)">
                <DateTimeInput aria-label="Chegada prevista" disabled={!editable} value={arrival} onChange={setArrival} />
            </Field>
            {electronic ? (
                <p className="gx-soft col-span-full text-[13.5px]">A averbação do seguro da carga é eletrônica (AT&M) e acompanha o CT-e de cada pedido.</p>
            ) : (
                <Field label="Averbação do seguro da carga" className="col-span-full">
                    <TextInput aria-label="Averbação do seguro" disabled={!editable} value={averbacao} onChange={(event) => setAverbacao(event.target.value)} />
                </Field>
            )}
            {editable ? (
                <div className="col-span-full">
                    <Button variant="primary" loading={busy === 'cover'} onClick={() => void save()}>
                        Salvar capa
                    </Button>
                </div>
            ) : null}
        </FormSection>
    );
};

const Freight: React.FC<StepProps> = ({ trip, perms }) => {
    const { busy, run } = useAction();
    const editable = perms.editCover.allowed;
    const agreement = useResource<ManifestFreightAgreement | null>(`manifest:freight:${trip.id}`, async () => (await manifestsApi.getFreightAgreement(trip.id)).data ?? null, { staleMs: 5_000 });
    const estimate = useResource<TripPriceEstimate | null>(`manifest:estimate:${trip.id}`, async () => (await manifestsApi.getTripPriceEstimate(trip.id)).data ?? null, { staleMs: 15_000 });
    const floor = useResource<AnttFloor | null>(`manifest:floor:${trip.id}`, async () => (await manifestsApi.anttFloor(trip.id)).data ?? null, { staleMs: 15_000 });
    const [bruto, setBruto] = useState<number | null>(null);
    const [pedagio, setPedagio] = useState<number | null>(null);
    const [adiantamento, setAdiantamento] = useState<number | null>(null);
    const [seeded, setSeeded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const current = agreement.data;
    const sugg = estimate.data;

    // Preenche uma vez: o que já está salvo; senão a estimativa do sistema (Copilot), que a pessoa confere.
    useEffect(() => {
        if (seeded) return;
        if (agreement.loadedAt == null && !agreement.error) return;
        if (estimate.loadedAt == null && !estimate.error) return;
        setBruto(current?.freteBruto ?? sugg?.suggestedFreteBruto ?? null);
        setPedagio(current?.pedagio ?? sugg?.suggestedPedagio ?? null);
        setAdiantamento(current?.adiantamento ?? null);
        setSeeded(true);
    }, [agreement.loadedAt, agreement.error, estimate.loadedAt, estimate.error, current, sugg, seeded]);

    const floorValue = floor.data;
    const below = isBelowAnttFloor(bruto ?? 0, floorValue);
    const view = marginView(trip);
    const save = async () => {
        if (bruto == null || bruto <= 0) {
            setError('Informe o frete bruto combinado com o transportador.');
            return;
        }
        setError(null);
        const ok = await run('freight', () => manifestsApi.upsertFreightAgreement(trip.id, { freteBruto: bruto, pedagio: pedagio ?? 0, adiantamento: adiantamento ?? 0 }), {
            success: 'Carta Frete salva.',
            error: 'Não foi possível salvar a Carta Frete.',
        });
        if (ok) refreshTrip();
    };

    return (
        <FormSection title="Carta Frete" hint="Valor combinado com o transportador nesta viagem." mode="copilot">
            {sugg?.suggestedFreteBruto ? (
                <div className="gx-inset col-span-full flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <p className="text-[13.5px]">
                        <span className="gx-label gx-royal-text block">Estimativa do sistema</span>
                        Frete {money(sugg.suggestedFreteBruto)}
                        {sugg.suggestedPedagio != null ? ` · pedágio ${money(sugg.suggestedPedagio)}` : ''}
                        {sugg.marginEstimate != null ? ` · margem estimada ${money(sugg.marginEstimate)}` : ''}
                    </p>
                    {editable ? (
                        <Button size="sm" onClick={() => { setBruto(sugg.suggestedFreteBruto); setPedagio(sugg.suggestedPedagio ?? pedagio); }}>
                            Usar estimativa
                        </Button>
                    ) : null}
                </div>
            ) : null}
            <div className="gx-inset col-span-full flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="text-[13.5px]" aria-live="polite">
                    <span className="gx-label gx-royal-text block">Piso mínimo ANTT</span>
                    {floor.error && !floorValue ? floor.error : floorValue ? formatAnttFloor(floorValue) : 'Calculando…'}
                </p>
                {editable && floorValue?.value != null ? (
                    <Button size="sm" onClick={() => setBruto(ceilAnttCents(floorValue.value as number))}>
                        Aplicar piso ({formatAnttMoney(floorValue.value)})
                    </Button>
                ) : null}
            </div>
            <Field label="Frete bruto" error={error}>
                <MoneyInput aria-label="Frete bruto" disabled={!editable} value={bruto} invalid={Boolean(error) || below} onChange={setBruto} />
            </Field>
            <Field label="Pedágio">
                <MoneyInput aria-label="Pedágio" disabled={!editable} value={pedagio} onChange={setPedagio} />
            </Field>
            <Field label="Adiantamento">
                <MoneyInput aria-label="Adiantamento" disabled={!editable} value={adiantamento} onChange={setAdiantamento} />
            </Field>
            {below ? <p className="gx-red-text col-span-full text-[13.5px] font-semibold" role="alert">Abaixo do piso mínimo ANTT. Revise o valor.</p> : null}
            <div className="col-span-full">
                <Kv label="Receita líquida" value={money(view.revenueNet)} />
                <Kv label="Custo do transportador" value={view.complete ? money(view.linkCost) : 'não lançado'} />
                <Kv label="Margem" value={view.hasMargin ? `${money(view.margin)} · ${pct(view.marginPercent, 1)}` : 'incompleta até salvar a Carta Frete'} strong />
                <ModeBadge mode="copilot" className="mt-1" />
            </div>
            {editable ? (
                <div className="col-span-full">
                    <Button variant="primary" loading={busy === 'freight'} onClick={() => void save()}>
                        Salvar Carta Frete
                    </Button>
                </div>
            ) : null}
        </FormSection>
    );
};

/** Etapa 4: capa (emitente, datas, lacre) e Carta Frete com a estimativa do sistema. */
export const CoverStep: React.FC<StepProps> = (props) => (
    <div className="flex flex-col gap-2">
        <Blocked reason={props.perms.editCover.reason} className="mb-3" />
        <Cover {...props} />
        <Freight {...props} />
    </div>
);
