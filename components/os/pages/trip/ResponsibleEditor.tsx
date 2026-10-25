import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { linksApi, manifestsApi, personsApi } from '../../../../lib/api';
import type { Driver, Link, Manifest, Person } from '../../../../types/index';
import {
    buildTripComposition,
    cnhStatus,
    compositionSuggestion,
    digits,
    driverBelongsToLink,
    driverSuggestion,
    manifestPlates,
    mergePersonDriverResults,
    setTrailerAt,
    sortDriversForLink,
    type DriverSearchRow,
    type TripCompositionPlates,
} from '../../lib/carrier';
import { linkCompositionPlates } from '../../lib/trip';
import { OsButton, OsEmpty } from '../../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../../ui/Sheet';
import DriverEditor from '../carrier/DriverEditor';
import { assignCarrier } from './assignCarrier';
import NewCarrierForm from './NewCarrierForm';
import PlatePicker from './PlatePicker';

/**
 * Responsável e composição da viagem: quatro escolhas INDEPENDENTES, cada uma trocável a qualquer
 * momento enquanto a viagem não sai do rascunho:
 *  - Transportador (quem responde contratualmente);
 *  - Motorista(s) (qualquer motorista cadastrado — o vínculo com o transportador é criado pelo backend);
 *  - Cavalo e Implementos 1..3 (qualquer combinação por placa, sem depender da composição do transportador).
 * Cada troca grava na hora. Escolher um transportador só SUGERE motorista e placas do cadastro dele:
 * vazio → preenche; já escolhido → pergunta antes de trocar. Dados de CIOT/MDF-e ficam na ficha.
 */

type View = 'main' | 'carrier' | 'newCarrier' | 'driver' | 'newDriver' | 'prefillDriver' | 'traction' | 'trailers';
type DriverTarget = { mode: 'replace'; index: number } | { mode: 'add' };

interface Offer {
    linkName: string;
    driver: Driver | null;
    plates: TripCompositionPlates | null;
}

const driversOf = (m: Manifest | null): Driver[] => {
    if (!m) return [];
    const rows = [...(m.driverAssignments ?? [])].sort((a, b) => a.sequence - b.sequence).map((a) => a.driver);
    if (rows.length === 0 && m.driver) return [m.driver];
    return rows;
};

const Row: React.FC<{
    label: string;
    value: string;
    detail?: string;
    tone?: 'ok' | 'warn' | 'bad' | 'muted';
    action: string;
    disabled?: boolean;
    onAction: () => void;
    secondary?: { label: string; onClick: () => void };
}> = ({ label, value, detail, tone = 'muted', action, disabled, onAction, secondary }) => (
    <div className="mt-2 flex items-center gap-3 rounded-xl border border-tower-200 bg-white p-3 first:mt-0 dark:border-tower-700 dark:bg-tower-900">
        <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-tower-500 dark:text-tower-400">{label}</p>
            <p className="truncate text-[15px] font-semibold text-tower-900 dark:text-white">{value}</p>
            {detail ? (
                <p
                    className={clsx(
                        'text-[12px] font-semibold',
                        tone === 'bad' && 'text-brand-red-600 dark:text-brand-red-400',
                        tone === 'warn' && 'text-[#6b5900] dark:text-brand-yellow-400',
                        (tone === 'ok' || tone === 'muted') && 'text-tower-500 dark:text-tower-400',
                    )}
                >
                    {detail}
                </p>
            ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end">
            <button
                type="button"
                disabled={disabled}
                onClick={onAction}
                className="min-h-[44px] px-2 text-[14px] font-bold text-brand-600 disabled:opacity-40 dark:text-brand-300"
            >
                {action}
            </button>
            {secondary ? (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={secondary.onClick}
                    className="min-h-[36px] px-2 text-[12px] font-bold text-tower-500 disabled:opacity-40 dark:text-tower-400"
                >
                    {secondary.label}
                </button>
            ) : null}
        </div>
    </div>
);

const ResponsibleEditor: React.FC<{
    manifestId: string;
    currentLinkId?: string | null;
    onClose: () => void;
    onSaved: () => void;
}> = ({ manifestId, onClose, onSaved }) => {
    const [manifest, setManifest] = useState<Manifest | null>(null);
    const [view, setView] = useState<View>('main');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [offer, setOffer] = useState<Offer | null>(null);
    // Transportador
    const [links, setLinks] = useState<Link[]>([]);
    const [q, setQ] = useState('');
    // Motorista
    const [target, setTarget] = useState<DriverTarget>({ mode: 'replace', index: 0 });
    const [linkDrivers, setLinkDrivers] = useState<Driver[]>([]);
    const [found, setFound] = useState<DriverSearchRow[]>([]);
    const [driverQ, setDriverQ] = useState('');
    const [pickingPerson, setPickingPerson] = useState<string | null>(null);
    const [prefill, setPrefill] = useState<(Driver & { person?: Person }) | null>(null);
    // Placas
    const [tractionDraft, setTractionDraft] = useState('');
    const [trailersDraft, setTrailersDraft] = useState<string[]>([]);
    const navigate = useNavigate();

    const link = manifest?.link ?? null;
    const linkId = manifest?.linkId ?? link?.id ?? null;
    const drivers = driversOf(manifest);
    const driverIds = drivers.map((d) => d.id);
    const plates = manifestPlates(manifest?.vehicleAssignments);
    const locked = manifest !== null && manifest.status !== 'DRAFT';
    const openRegistry = (id: string) => navigate(`/hubs/transportadores/${id}?viagem=${manifestId}`);

    const load = useCallback(async () => {
        const body = await manifestsApi.getById(manifestId);
        setManifest(body.data);
        return body.data;
    }, [manifestId]);

    useEffect(() => {
        load().catch(() => setError('Não foi possível carregar a viagem.'));
    }, [load]);

    const lockedMessage =
        manifest?.status === 'PENDING_ACCEPT'
            ? 'A oferta já foi enviada. Retire a oferta para trocar o responsável, o motorista ou os veículos.'
            : manifest?.status === 'ACCEPTED'
              ? 'A viagem já foi aceita. Reabra o planejamento (com motivo) para trocar o responsável, o motorista ou os veículos.'
              : 'Esta viagem não está mais em rascunho e não aceita troca de responsável.';

    // Executa uma troca, recarrega a viagem e mostra a mensagem do servidor se for recusada.
    const change = async (fn: () => Promise<unknown>, fallback: string): Promise<boolean> => {
        if (busy) return false;
        setBusy(true);
        setError(null);
        try {
            await fn();
            await load();
            setDirty(true);
            return true;
        } catch (cause) {
            setError(apiErrorMessage(cause, fallback));
            await load().catch(() => undefined);
            return false;
        } finally {
            setBusy(false);
        }
    };

    // ---------------- Transportador ----------------
    const openCarrierPicker = () => {
        setError(null);
        setQ('');
        setView('carrier');
        if (links.length === 0) {
            linksApi
                .list({ approvalStatus: 'APPROVED' })
                .then((body) => setLinks((Array.isArray(body.data) ? body.data : []) as Link[]))
                .catch(() => setError('Não foi possível carregar os transportadores.'));
        }
    };

    const filteredLinks = useMemo(() => {
        const term = q.trim().toLowerCase();
        const doc = digits(q);
        if (!term) return links.slice(0, 30);
        return links
            .filter((l) => `${l.name} ${l.vehiclePlate ?? ''} ${l.homeBase ?? ''}`.toLowerCase().includes(term) || (doc.length >= 3 && digits(l.document).includes(doc)))
            .slice(0, 30);
    }, [links, q]);

    const chooseCarrier = async (picked: Link) => {
        const prevPlates = plates;
        const prevIds = driverIds;
        const ok = await change(async () => {
            // Pendente cadastrado por este hub: aprovar é dele (o backend recusa se for de outro hub).
            if (picked.approvalStatus === 'PENDING') await linksApi.approve(picked.id);
            await assignCarrier(manifestId, picked.id, prevIds);
        }, 'Não foi possível trocar o transportador.');
        if (!ok) return;
        setView('main');
        await suggestFromCarrier(picked, prevIds, prevPlates);
    };

    // O cadastro do transportador só sugere: vazio → preenche; já escolhido e diferente → pergunta.
    const suggestFromCarrier = async (picked: Link, prevIds: string[], prevPlates: TripCompositionPlates) => {
        setOffer(null);
        try {
            const fresh = await load();
            const registered = ((await linksApi.getDrivers(picked.id).catch(() => ({ data: [] as Driver[] }))).data ?? []).filter((d) => d.active !== false);
            const candidate = registered.length === 1 ? registered[0] : null;
            const currentIds = driversOf(fresh).map((d) => d.id);
            const driverSug = driverSuggestion(candidate?.id, prevIds[0] ?? currentIds[0] ?? null);
            const suggested = linkCompositionPlates(picked);
            const plateSug = compositionSuggestion(suggested, prevPlates);
            if (driverSug.apply && candidate) await manifestsApi.setDrivers(manifestId, [candidate.id]);
            if (plateSug.apply) {
                const composition = buildTripComposition(suggested.traction ?? '', suggested.trailers);
                if (composition) await manifestsApi.setVehicles(manifestId, composition);
            }
            if (driverSug.apply || plateSug.apply) await load();
            if ((driverSug.ask && candidate) || plateSug.ask) {
                setOffer({ linkName: picked.name, driver: driverSug.ask ? candidate : null, plates: plateSug.ask ? suggested : null });
            }
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Transportador trocado, mas não foi possível aplicar a composição cadastrada.'));
        }
    };

    const applyOffer = async () => {
        if (!offer) return;
        const current = offer;
        const ok = await change(async () => {
            if (current.driver) {
                const first = current.driver.id;
                await manifestsApi.setDrivers(manifestId, [first, ...driverIds.slice(1).filter((id) => id !== first)]);
            }
            if (current.plates) {
                const composition = buildTripComposition(current.plates.traction ?? '', current.plates.trailers);
                if (composition) await manifestsApi.setVehicles(manifestId, composition);
            }
        }, 'Não foi possível usar a composição cadastrada.');
        if (ok) setOffer(null);
    };

    // ---------------- Motorista ----------------
    const openDriverPicker = (next: DriverTarget) => {
        setError(null);
        setTarget(next);
        setDriverQ('');
        setFound([]);
        setView('driver');
        if (linkId) {
            linksApi
                .getDrivers(linkId)
                .then((body) =>
                    setLinkDrivers(
                        (Array.isArray(body.data) ? body.data : [])
                            .filter((d) => d.active !== false)
                            .map((d) => ({ ...d, carriers: d.carriers ?? [{ linkId, active: true }] })),
                    ),
                )
                .catch(() => setLinkDrivers([]));
        } else {
            setLinkDrivers([]);
        }
    };

    // Busca global (nome ou CPF): o motorista é independente do transportador e do veículo.
    useEffect(() => {
        const term = driverQ.trim();
        if (view !== 'driver' || term.length < 2) {
            setFound([]);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            Promise.all([
                personsApi.search(term, 'CPF').catch(() => ({ data: [] as Person[] })),
                linksApi.searchDrivers(term).catch(() => ({ data: [] as Driver[] })),
            ]).then(([persons, found]) => {
                if (cancelled) return;
                setFound(mergePersonDriverResults(Array.isArray(persons.data) ? persons.data : [], Array.isArray(found.data) ? found.data : []));
            });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [driverQ, view]);

    const driverRows = useMemo<DriverSearchRow[]>(() => {
        const searching = driverQ.trim().length >= 2;
        const asRow = (d: Driver): DriverSearchRow => ({ personId: null, driver: d, document: d.document, name: d.name, roles: ['motorista'] });
        return searching ? found : (linkId ? sortDriversForLink(linkDrivers, linkId) : linkDrivers).map(asRow);
    }, [linkId, linkDrivers, found, driverQ]);

    const nextDriverIds = (driverId: string): string[] => {
        if (target.mode === 'add' || driverIds.length === 0) return [...driverIds.filter((id) => id !== driverId), driverId];
        const replaced = driverIds.map((id, i) => (i === target.index ? driverId : id));
        return replaced.filter((id, i) => replaced.indexOf(id) === i);
    };

    const applyDriver = async (driverId: string): Promise<boolean> => {
        if (!linkId) {
            setError('Escolha o transportador antes do motorista.');
            return false;
        }
        const ok = await change(() => manifestsApi.setDrivers(manifestId, nextDriverIds(driverId)), 'Não foi possível trocar o motorista.');
        if (ok) setView('main');
        return ok;
    };

    const removeDriver = (driverId: string) =>
        void change(() => manifestsApi.setDrivers(manifestId, driverIds.filter((id) => id !== driverId)), 'Não foi possível remover o motorista.');

    // Pessoa já cadastrada (cliente, transportador…) sem papel de motorista: cria o papel a partir dela.
    const pickRow = async (row: DriverSearchRow) => {
        if (busy || pickingPerson) return;
        if (row.driver && row.roles.includes('motorista')) {
            await applyDriver(row.driver.id);
            return;
        }
        if (!row.personId) return;
        setPickingPerson(row.personId);
        setError(null);
        try {
            const body = await personsApi.asDriver(row.personId, linkId ?? undefined);
            const { driver, missingForCiot } = body.data;
            const ok = await applyDriver(driver.id);
            if (ok && missingForCiot.length > 0) {
                const persons = await personsApi.search(digits(row.document), 'CPF').catch(() => ({ data: [] as Person[] }));
                const person = persons.data.find((p) => p.id === row.personId);
                setPrefill({ ...driver, person: person ?? driver.person } as Driver & { person?: Person });
                setView('prefillDriver');
            }
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível usar esta pessoa como motorista.'));
        } finally {
            setPickingPerson(null);
        }
    };

    // ---------------- Veículos ----------------
    const openTraction = () => {
        setError(null);
        setTractionDraft(plates.traction ?? '');
        setView('traction');
    };
    const openTrailers = () => {
        setError(null);
        setTrailersDraft(plates.trailers.slice(0, 3));
        setView('trailers');
    };

    const saveComposition = async (traction: string, trailers: string[]) => {
        const composition = buildTripComposition(traction, trailers);
        if (!composition) {
            setError('Informe a placa do cavalo com 7 letras/números.');
            return;
        }
        const ok = await change(() => manifestsApi.setVehicles(manifestId, composition), 'Não foi possível salvar os veículos.');
        if (ok) setView('main');
    };

    const finish = () => (dirty ? onSaved() : onClose());
    const back = () => {
        setError(null);
        setView('main');
    };

    // ---------------- Telas ----------------
    if (view === 'prefillDriver' && prefill && linkId) {
        return (
            <DriverEditor
                linkId={linkId}
                driver={prefill as never}
                onClose={() => {
                    setPrefill(null);
                    setView('main');
                }}
                onSaved={() => {
                    setPrefill(null);
                    setView('main');
                    void load();
                }}
            />
        );
    }

    if (view === 'newDriver' && linkId) {
        return (
            <DriverEditor
                linkId={linkId}
                driver={null}
                onClose={() => setView('driver')}
                onSaved={(id) => {
                    setDriverQ('');
                    void applyDriver(id);
                }}
            />
        );
    }

    const errorBox = error ? (
        <p className="mb-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p>
    ) : null;

    if (view === 'newCarrier') {
        return (
            <OsSheet title="Cadastrar transportador" subtitle="Vai para esta viagem" onClose={finish}>
                <NewCarrierForm
                    manifestId={manifestId}
                    keepDriverIds={driverIds}
                    onCreated={openRegistry}
                    onUsed={() => {
                        setDirty(true);
                        void load();
                        setView('main');
                    }}
                    onCancel={() => setView('carrier')}
                />
            </OsSheet>
        );
    }

    if (view === 'carrier') {
        return (
            <OsSheet title="Trocar transportador" subtitle="Motorista e veículos não mudam" onClose={finish} footer={errorBox}>
                <OsButton full variant="secondary" className="mb-3" onClick={() => setView('newCarrier')}>
                    Cadastrar transportador
                </OsButton>
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, CPF/CNPJ, placa ou base…" className={osFieldClass} />
                <div className="mt-2 flex flex-col gap-2">
                    {filteredLinks.length === 0 ? <OsEmpty title="Nenhum transportador aprovado encontrado" /> : null}
                    {filteredLinks.map((l) => (
                        <button
                            key={l.id}
                            type="button"
                            disabled={busy}
                            onClick={() => void chooseCarrier(l)}
                            className={clsx(
                                'flex min-h-[56px] flex-col justify-center rounded-xl border bg-white px-3.5 text-left active:bg-tower-50 disabled:opacity-60 dark:bg-tower-900 dark:active:bg-tower-800',
                                l.id === linkId ? 'border-2 border-brand-500' : 'border-tower-200 dark:border-tower-700',
                            )}
                        >
                            <span className="text-[14px] font-semibold text-tower-900 dark:text-white">{l.name}{l.id === linkId ? ' · atual' : ''}</span>
                            <span className="text-[12px] text-tower-500 dark:text-tower-400">
                                {linkCompositionPlates(l).traction ?? 'sem placa'} · {l.homeBase}
                                {l.approvalStatus === 'PENDING' ? ' · pendente (será aprovado ao usar)' : ''}
                            </span>
                        </button>
                    ))}
                </div>
                <OsButton full variant="ghost" className="mt-2" onClick={back}>
                    Voltar
                </OsButton>
            </OsSheet>
        );
    }

    if (view === 'driver') {
        const replacing = target.mode === 'replace' && drivers[target.index];
        return (
            <OsSheet
                title={target.mode === 'add' ? 'Adicionar motorista' : 'Trocar motorista'}
                subtitle={replacing ? `Atual: ${replacing.name}` : 'Qualquer motorista cadastrado'}
                onClose={finish}
                footer={errorBox}
            >
                {!linkId ? <p className="mb-2 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">Escolha o transportador antes do motorista.</p> : null}
                <input
                    type="search"
                    value={driverQ}
                    onChange={(e) => setDriverQ(e.target.value)}
                    placeholder="Buscar motorista por nome ou CPF…"
                    className={osFieldClass}
                />
                <div className="mt-2 flex flex-col gap-2">
                    {driverRows.length === 0 ? (
                        <p className="text-[13px] text-tower-500 dark:text-tower-400">
                            {driverQ.trim().length >= 2 ? 'Nenhum motorista encontrado.' : 'Busque por nome ou CPF — o motorista não precisa ser do transportador.'}
                        </p>
                    ) : null}
                    {driverRows.map((row) => {
                        const d = row.driver;
                        const isDriver = Boolean(d) && row.roles.includes('motorista');
                        const selected = Boolean(d) && driverIds.includes(d!.id);
                        const cnh = cnhStatus(d?.cnhExpiry);
                        return (
                            <button
                                key={row.document}
                                type="button"
                                disabled={busy || !linkId}
                                onClick={() => void pickRow(row)}
                                className={clsx(
                                    'flex min-h-[48px] items-center gap-3 rounded-xl border-2 p-3 text-left disabled:opacity-60',
                                    selected ? 'border-brand-500 bg-brand-500/8' : 'border-tower-200 dark:border-tower-700',
                                    pickingPerson && pickingPerson === row.personId && 'opacity-60',
                                )}
                            >
                                <span className="flex min-w-0 flex-col">
                                    <span className="text-[14px] font-semibold text-tower-900 dark:text-white">{row.name}{selected ? ' · na viagem' : ''}</span>
                                    <span className="text-[12px] text-tower-500 dark:text-tower-400">
                                        CPF {row.document}
                                        {d && isDriver && linkId && !driverBelongsToLink(d, linkId) ? ' · será vinculado ao transportador' : ''}
                                    </span>
                                    {row.roles.length > 0 ? (
                                        <span className="mt-0.5 flex flex-wrap gap-1">
                                            {row.roles.map((role) => (
                                                <span key={role} className="rounded-full bg-tower-100 px-2 py-0.5 text-[11px] font-semibold text-tower-600 dark:bg-tower-800 dark:text-tower-300">
                                                    {role}
                                                </span>
                                            ))}
                                        </span>
                                    ) : null}
                                    {!isDriver ? (
                                        <span className="text-[12px] font-semibold text-brand-600 dark:text-brand-300">
                                            {pickingPerson === row.personId ? 'Cadastrando como motorista…' : 'Pessoa já cadastrada — usar como motorista'}
                                        </span>
                                    ) : null}
                                    <span
                                        className={clsx(
                                            'text-[12px] font-semibold',
                                            cnh.tone === 'bad' && 'text-brand-red-600 dark:text-brand-red-400',
                                            cnh.tone === 'warn' && 'text-[#6b5900] dark:text-brand-yellow-400',
                                            (cnh.tone === 'ok' || cnh.tone === 'missing') && 'text-tower-500 dark:text-tower-400',
                                        )}
                                    >
                                        {cnh.label}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>
                <OsButton full variant="secondary" className="mt-3" disabled={!linkId} onClick={() => setView('newDriver')}>
                    Cadastrar motorista
                </OsButton>
                <OsButton full variant="ghost" className="mt-1" onClick={back}>
                    Voltar
                </OsButton>
            </OsSheet>
        );
    }

    if (view === 'traction') {
        return (
            <OsSheet
                title="Cavalo da viagem"
                subtitle="Qualquer cavalo, por placa"
                onClose={finish}
                footer={
                    <>
                        {errorBox}
                        <OsButton full disabled={busy} onClick={() => void saveComposition(tractionDraft, plates.trailers)}>
                            {busy ? 'Salvando…' : 'Salvar cavalo'}
                        </OsButton>
                        <OsButton full variant="ghost" className="mt-1" disabled={busy} onClick={back}>
                            Voltar
                        </OsButton>
                    </>
                }
            >
                <PlatePicker label="Cavalo" role="TRACTION" value={tractionDraft} onChange={setTractionDraft} />
                <p className="mt-1.5 text-[12px] text-tower-500 dark:text-tower-400">
                    Vale só para esta viagem; não depende do transportador nem do motorista.
                </p>
            </OsSheet>
        );
    }

    if (view === 'trailers') {
        return (
            <OsSheet
                title="Implementos da viagem"
                subtitle="Até 3, qualquer combinação por placa"
                onClose={finish}
                footer={
                    <>
                        {errorBox}
                        <OsButton full disabled={busy} onClick={() => void saveComposition(plates.traction ?? '', trailersDraft)}>
                            {busy ? 'Salvando…' : 'Salvar implementos'}
                        </OsButton>
                        <OsButton full variant="ghost" className="mt-1" disabled={busy} onClick={back}>
                            Voltar
                        </OsButton>
                    </>
                }
            >
                {!plates.traction ? (
                    <p className="mb-2 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">Informe o cavalo antes dos implementos.</p>
                ) : null}
                {[0, 1, 2].slice(0, Math.min(3, trailersDraft.length + 1)).map((index) => (
                    <PlatePicker
                        key={index}
                        label={`Implemento ${index + 1}`}
                        role="TRAILER"
                        value={trailersDraft[index] ?? ''}
                        onChange={(plate) =>
                            setTrailersDraft((list) => {
                                const next = [...list];
                                next[index] = plate;
                                return next;
                            })
                        }
                        onClear={trailersDraft[index] ? () => setTrailersDraft((list) => setTrailerAt(list, index, null)) : undefined}
                    />
                ))}
            </OsSheet>
        );
    }

    // ---------------- Principal ----------------
    const carrierDetail = link ? [link.carrierType, digits(link.document).length === 14 ? 'CNPJ' : 'CPF'].filter(Boolean).join(' · ') : undefined;
    const primary = drivers[0] ?? null;
    const primaryCnh = cnhStatus(primary?.cnhExpiry);

    return (
        <OsSheet
            title="Responsável e composição"
            subtitle="Cada item muda sozinho; os outros ficam como estão"
            onClose={finish}
            footer={
                <>
                    {errorBox}
                    <OsButton full disabled={busy} onClick={finish}>
                        Concluir
                    </OsButton>
                    {linkId ? (
                        <OsButton full variant="ghost" className="mt-1" disabled={busy} onClick={() => openRegistry(linkId)}>
                            Completar cadastro (CIOT/MDF-e)
                        </OsButton>
                    ) : null}
                </>
            }
        >
            {!manifest ? <p className="text-[13px] text-tower-500 dark:text-tower-400">{error ?? 'Carregando…'}</p> : null}
            {locked ? (
                <p className="mb-3 rounded-lg bg-brand-yellow-400/25 p-3 text-[13px] font-semibold text-[#6b5900] dark:bg-brand-yellow-400/15 dark:text-brand-yellow-400">{lockedMessage}</p>
            ) : null}
            {offer ? (
                <div className="mb-3 rounded-xl border-2 border-brand-500 bg-brand-500/8 p-3.5">
                    <p className="text-[14px] font-bold text-tower-900 dark:text-white">Usar a composição cadastrada deste transportador?</p>
                    <p className="mt-1 text-[12px] text-tower-600 dark:text-tower-300">
                        {offer.linkName} tem cadastro próprio, diferente do que já está nesta viagem.
                    </p>
                    {offer.driver ? <p className="mt-1 text-[13px] text-tower-700 dark:text-tower-200">Motorista: {offer.driver.name}</p> : null}
                    {offer.plates ? (
                        <p className="text-[13px] text-tower-700 dark:text-tower-200">
                            Cavalo {offer.plates.traction ?? '—'}
                            {offer.plates.trailers.length ? ` · Implementos ${offer.plates.trailers.join(', ')}` : ''}
                        </p>
                    ) : null}
                    <OsButton full className="mt-3" disabled={busy} onClick={() => void applyOffer()}>
                        {busy ? 'Aplicando…' : 'Usar composição cadastrada'}
                    </OsButton>
                    <OsButton full variant="ghost" className="mt-1" disabled={busy} onClick={() => setOffer(null)}>
                        Manter o que está na viagem
                    </OsButton>
                </div>
            ) : null}

            <Row
                label="Transportador"
                value={link?.name ?? 'Não definido'}
                detail={carrierDetail ?? 'Quem responde contratualmente pela viagem'}
                action={link ? 'Trocar' : 'Escolher'}
                disabled={busy || locked || !manifest}
                onAction={openCarrierPicker}
            />
            <Row
                label={drivers.length > 1 ? 'Motorista principal' : 'Motorista'}
                value={primary?.name ?? 'Não definido'}
                detail={primary ? `${primaryCnh.label} · CPF ${primary.document}` : linkId ? 'Qualquer motorista cadastrado' : 'Escolha o transportador primeiro'}
                tone={primary ? (primaryCnh.tone === 'bad' ? 'bad' : primaryCnh.tone === 'warn' ? 'warn' : 'muted') : 'muted'}
                action={primary ? 'Trocar' : 'Escolher'}
                disabled={busy || locked || !linkId}
                onAction={() => openDriverPicker({ mode: 'replace', index: 0 })}
            />
            {drivers.slice(1).map((d, i) => (
                <Row
                    key={d.id}
                    label={`Motorista ${i + 2}`}
                    value={d.name}
                    detail={cnhStatus(d.cnhExpiry).label}
                    action="Trocar"
                    secondary={{ label: 'Remover', onClick: () => removeDriver(d.id) }}
                    disabled={busy || locked}
                    onAction={() => openDriverPicker({ mode: 'replace', index: i + 1 })}
                />
            ))}
            {primary && drivers.length < 3 ? (
                <button
                    type="button"
                    disabled={busy || locked}
                    onClick={() => openDriverPicker({ mode: 'add' })}
                    className="mt-1 min-h-[44px] px-1 text-[13px] font-bold text-brand-600 disabled:opacity-40 dark:text-brand-300"
                >
                    Adicionar outro motorista
                </button>
            ) : null}
            <Row
                label="Cavalo"
                value={plates.traction ?? 'Não informado'}
                detail="Placa da viagem, independente do transportador"
                action={plates.traction ? 'Trocar' : 'Informar'}
                disabled={busy || locked || !manifest}
                onAction={openTraction}
            />
            <Row
                label="Implementos"
                value={plates.trailers.length ? plates.trailers.join(' · ') : 'Nenhum'}
                detail={plates.trailers.length ? `${plates.trailers.length} de 3` : 'Até 3 implementos'}
                action={plates.trailers.length ? 'Trocar' : 'Informar'}
                disabled={busy || locked || !manifest}
                onAction={openTrailers}
            />
        </OsSheet>
    );
};

export default ResponsibleEditor;
