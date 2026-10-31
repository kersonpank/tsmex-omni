import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { fiscalEmittersApi, manifestsApi } from '../../../../lib/api';
import type { FiscalEmitter, TripPriceEstimate } from '../../../../types/index';
import { parseMoney } from '../../lib/trip';
import { OsButton } from '../../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../../ui/Sheet';

/** Editores curtos da estação Preparar e despachar: saída prevista, emitente e Carta Frete. */

type EditorProps = { manifestId: string; onClose: () => void; onSaved: () => void };

function toLocalInput(iso: string | null | undefined, fallbackHours: number): string {
    const d = iso ? new Date(iso) : new Date(Date.now() + fallbackHours * 3_600_000);
    if (!iso) d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ErrorLine: React.FC<{ message: string | null }> = ({ message }) =>
    message ? (
        <p className="mb-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">
            {message}
        </p>
    ) : null;

export const DepartureEditor: React.FC<EditorProps & { departure?: string | null; arrival?: string | null }> = ({
    manifestId,
    departure,
    arrival,
    onClose,
    onSaved,
}) => {
    const [dep, setDep] = useState(() => toLocalInput(departure, 1));
    const [arr, setArr] = useState(() => (arrival ? toLocalInput(arrival, 0) : ''));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            await manifestsApi.updateCapa(manifestId, {
                plannedDepartureAt: new Date(dep).toISOString(),
                ...(arr ? { plannedArrivalAt: new Date(arr).toISOString() } : {}),
            });
            onSaved();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível salvar as datas.'));
            setBusy(false);
        }
    };

    return (
        <OsSheet
            title="Saída prevista"
            onClose={onClose}
            footer={
                <>
                    <ErrorLine message={error} />
                    <OsButton full disabled={!dep || busy} onClick={() => void save()}>
                        {busy ? 'Salvando…' : 'Salvar'}
                    </OsButton>
                </>
            }
        >
            <label className="block text-[13px] font-bold text-tower-600 dark:text-tower-300">
                Saída
                <input type="datetime-local" value={dep} onChange={(e) => setDep(e.target.value)} className={clsx(osFieldClass, 'mt-1.5')} />
            </label>
            <label className="mt-4 block text-[13px] font-bold text-tower-600 dark:text-tower-300">
                Chegada prevista (opcional)
                <input type="datetime-local" value={arr} onChange={(e) => setArr(e.target.value)} className={clsx(osFieldClass, 'mt-1.5')} />
            </label>
        </OsSheet>
    );
};

export const EmitterEditor: React.FC<EditorProps & { hubId: string; current?: string | null }> = ({
    manifestId,
    hubId,
    current,
    onClose,
    onSaved,
}) => {
    const [emitters, setEmitters] = useState<FiscalEmitter[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [efrete, setEfrete] = useState<{ configured: boolean; environment: string; integratorCnpjMasked: string | null } | null>(null);

    useEffect(() => {
        fiscalEmittersApi
            .efreteStatus()
            .then((body) => setEfrete(body.data ?? null))
            .catch(() => setEfrete(null));
    }, []);

    useEffect(() => {
        fiscalEmittersApi
            .list({ hubId })
            .then((body) => setEmitters((body.data ?? []).filter((e) => e.active)))
            .catch(() => setError('Não foi possível carregar os emitentes.'));
    }, [hubId]);

    const pick = async (id: string) => {
        setBusyId(id);
        setError(null);
        try {
            await manifestsApi.updateCapa(manifestId, { fiscalEmitterId: id });
            onSaved();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível definir o emitente.'));
            setBusyId(null);
        }
    };

    return (
        <OsSheet title="Emitente fiscal" subtitle="Empresa que emite CT-e e MDF-e e contrata o CIOT desta viagem" onClose={onClose}>
            <ErrorLine message={error} />
            {efrete ? (
                <p className="mb-3 rounded-xl bg-tower-100 px-3 py-2.5 text-[12px] leading-snug text-tower-600 dark:bg-tower-800 dark:text-tower-300">
                    {efrete.configured
                        ? `Integração e-Frete (CIOT): credenciais do integrador configuradas no servidor · ambiente ${efrete.environment === 'producao' ? 'produção' : 'homologação'}.${
                              efrete.environment === 'producao'
                                  ? ''
                                  : ` Em homologação o contratante do CIOT é o CNPJ do integrador${efrete.integratorCnpjMasked ? ` (${efrete.integratorCnpjMasked})` : ''}.`
                          }`
                        : 'Credenciais do integrador e-Frete não configuradas — a torre define no servidor (variáveis EFRETE_HOMOLOGACAO_*).'}
                </p>
            ) : null}
            <div className="flex flex-col gap-2">
                {emitters.map((e) => (
                    <button
                        key={e.id}
                        type="button"
                        disabled={Boolean(busyId)}
                        onClick={() => void pick(e.id)}
                        className={clsx(
                            'flex min-h-[56px] flex-col justify-center rounded-xl border-2 px-3.5 text-left',
                            current === e.id ? 'border-brand-500 bg-brand-500/8' : 'border-tower-200 dark:border-tower-700',
                        )}
                    >
                        <span className="text-[14px] font-semibold text-tower-900 dark:text-white">
                            {busyId === e.id ? 'Salvando…' : e.displayName ?? e.tradeName ?? e.person?.legalName}
                        </span>
                        <span className="text-[12px] text-tower-500 dark:text-tower-400">
                            {e.environment === 'PRODUCAO' ? 'produção' : 'homologação'}
                            {e.defaultForHub || emitters.length === 1 ? ' · automático' : ''}
                        </span>
                    </button>
                ))}
                {emitters.length === 0 && !error ? (
                    <p className="text-[13px] text-tower-500">Nenhum emitente ativo para este hub. A torre cadastra em Fiscal.</p>
                ) : null}
            </div>
        </OsSheet>
    );
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const toNumber = parseMoney;
const toField = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

export const FreightEditor: React.FC<EditorProps> = ({ manifestId, onClose, onSaved }) => {
    const [bruto, setBruto] = useState('');
    const [pedagio, setPedagio] = useState('');
    const [adiantamento, setAdiantamento] = useState('');
    const [estimate, setEstimate] = useState<TripPriceEstimate | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        Promise.allSettled([manifestsApi.getFreightAgreement(manifestId), manifestsApi.getTripPriceEstimate(manifestId)]).then(
            ([agreement, est]) => {
                const current = agreement.status === 'fulfilled' ? agreement.value.data : null;
                const estimateData = est.status === 'fulfilled' ? (est.value.data as TripPriceEstimate) : null;
                setEstimate(estimateData);
                setBruto(toField(current?.freteBruto ?? estimateData?.suggestedFreteBruto));
                setPedagio(toField(current?.pedagio ?? estimateData?.suggestedPedagio));
                setAdiantamento(toField(current?.adiantamento));
            },
        );
    }, [manifestId]);

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            await manifestsApi.upsertFreightAgreement(manifestId, {
                freteBruto: toNumber(bruto),
                pedagio: toNumber(pedagio),
                adiantamento: toNumber(adiantamento),
            });
            onSaved();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível salvar a Carta Frete.'));
            setBusy(false);
        }
    };

    const field = (label: string, value: string, set: (v: string) => void) => (
        <label className="mt-3 block text-[13px] font-bold text-tower-600 first:mt-0 dark:text-tower-300">
            {label}
            <input inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} placeholder="0,00" className={clsx(osFieldClass, 'mt-1.5')} />
        </label>
    );

    return (
        <OsSheet
            title="Carta Frete"
            subtitle="Valor acordado com o transportador nesta viagem"
            onClose={onClose}
            footer={
                <>
                    <ErrorLine message={error} />
                    <OsButton full disabled={toNumber(bruto) <= 0 || busy} onClick={() => void save()}>
                        {busy ? 'Salvando…' : 'Salvar Carta Frete'}
                    </OsButton>
                </>
            }
        >
            {estimate?.suggestedFreteBruto ? (
                <p className="mb-3 rounded-lg bg-brand-500/8 p-3 text-[13px] text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
                    Sugestão pelo acordo do transportador: {brl.format(estimate.suggestedFreteBruto)}
                    {estimate.marginEstimate != null ? ` · margem estimada ${brl.format(estimate.marginEstimate)}` : ''}
                </p>
            ) : null}
            {estimate?.floorComparison === 'BELOW' ? (
                <p className="mb-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">
                    Abaixo do piso mínimo ANTT. Revise o valor.
                </p>
            ) : null}
            {field('Frete bruto (R$)', bruto, setBruto)}
            {field('Pedágio (R$)', pedagio, setPedagio)}
            {field('Adiantamento (R$)', adiantamento, setAdiantamento)}
        </OsSheet>
    );
};
