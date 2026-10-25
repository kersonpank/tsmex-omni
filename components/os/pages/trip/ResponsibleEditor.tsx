import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { linksApi, manifestsApi } from '../../../../lib/api';
import type { Driver, Link } from '../../../../types/index';
import { buildTripComposition, cnhStatus, driverBelongsToLink, sortDriversForLink } from '../../lib/carrier';
import { linkCompositionPlates } from '../../lib/trip';
import { OsButton, OsEmpty } from '../../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../../ui/Sheet';
import DriverEditor from '../carrier/DriverEditor';
import NewCarrierForm from './NewCarrierForm';
import PlatePicker from './PlatePicker';

/**
 * Transportador e motorista da viagem: escolhe (ou cadastra) o transportador, o motorista
 * (qualquer motorista cadastrado — o vínculo com o transportador é criado pelo backend) e a
 * composição da viagem (cavalo + até 3 implementos, por busca ou placa digitada).
 * Dados de CIOT/MDF-e ficam na ficha. Duas escritas: responsável (transportador + motorista) e composição.
 */

const ResponsibleEditor: React.FC<{
    manifestId: string;
    currentLinkId?: string | null;
    onClose: () => void;
    onSaved: () => void;
}> = ({ manifestId, currentLinkId, onClose, onSaved }) => {
    const [links, setLinks] = useState<Link[]>([]);
    const [q, setQ] = useState('');
    const [link, setLink] = useState<Link | null>(null);
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [found, setFound] = useState<Driver[]>([]);
    const [driverQ, setDriverQ] = useState('');
    const [driverId, setDriverId] = useState<string | null>(null);
    const [newDriver, setNewDriver] = useState(false);
    const [traction, setTraction] = useState('');
    const [trailers, setTrailers] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const navigate = useNavigate();
    const openRegistry = (linkId: string) => navigate(`/hubs/transportadores/${linkId}?viagem=${manifestId}`);

    useEffect(() => {
        linksApi
            .list({ approvalStatus: 'APPROVED' })
            .then((body) => {
                const rows = (Array.isArray(body.data) ? body.data : []) as Link[];
                setLinks(rows);
                const current = rows.find((l) => l.id === currentLinkId);
                if (current) setLink(current);
            })
            .catch(() => setError('Não foi possível carregar os transportadores.'));
    }, [currentLinkId]);

    const loadLinkDrivers = (target: Link, select?: string) =>
        linksApi
            .getDrivers(target.id)
            .then((body) => {
                const rows = (Array.isArray(body.data) ? body.data : [])
                    .filter((d) => d.active !== false)
                    .map((d) => ({ ...d, carriers: d.carriers ?? [{ linkId: target.id, active: true }] }));
                setDrivers(rows);
                if (select) setDriverId(select);
                else if (rows.length === 1) setDriverId((current) => current ?? rows[0].id);
            })
            .catch(() => setDrivers([]));

    useEffect(() => {
        if (!link) return;
        setDrivers([]);
        setFound([]);
        setDriverQ('');
        setDriverId(null);
        const plates = linkCompositionPlates(link);
        setTraction(plates.traction ?? '');
        setTrailers(plates.trailers.slice(0, 3));
        void loadLinkDrivers(link);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [link]);

    // Busca global (nome ou CPF): o motorista é independente do transportador e do veículo.
    useEffect(() => {
        const term = driverQ.trim();
        if (term.length < 2) {
            setFound([]);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            linksApi
                .searchDrivers(term)
                .then((body) => {
                    if (!cancelled) setFound(Array.isArray(body.data) ? body.data : []);
                })
                .catch(() => {
                    if (!cancelled) setFound([]);
                });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [driverQ]);

    const driverRows = useMemo(() => {
        if (!link) return [];
        const searching = driverQ.trim().length >= 2;
        const byId = new Map<string, Driver>();
        for (const d of searching ? found : drivers) byId.set(d.id, d);
        // O selecionado nunca some da lista, mesmo que a busca não o traga.
        const selected = driverId ? [...drivers, ...found].find((d) => d.id === driverId) : undefined;
        if (selected) byId.set(selected.id, selected);
        return sortDriversForLink([...byId.values()], link.id);
    }, [link, drivers, found, driverQ, driverId]);

    const filtered = useMemo(() => {
        const term = q.trim().toLowerCase();
        if (!term) return links.slice(0, 30);
        return links
            .filter((l) => `${l.name} ${l.vehiclePlate ?? ''} ${l.homeBase ?? ''}`.toLowerCase().includes(term))
            .slice(0, 30);
    }, [links, q]);

    const save = async (thenOpenRegistry = false) => {
        if (!link || busy) return;
        setBusy(true);
        setError(null);
        try {
            // Pendente cadastrado por este hub: aprovar é dele (o backend recusa se for de outro hub).
            if (link.approvalStatus === 'PENDING') await linksApi.approve(link.id);
            // O backend vincula o motorista escolhido ao transportador, se ainda não estiver vinculado.
            await manifestsApi.setResponsible(manifestId, link.id, driverId);
            const composition = buildTripComposition(traction, trailers);
            if (composition) await manifestsApi.setVehicles(manifestId, composition);
            if (thenOpenRegistry) openRegistry(link.id);
            else onSaved();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível salvar o transportador.'));
            setBusy(false);
        }
    };

    if (newDriver && link) {
        return (
            <DriverEditor
                linkId={link.id}
                driver={null}
                onClose={() => setNewDriver(false)}
                onSaved={(id) => {
                    setNewDriver(false);
                    setDriverQ('');
                    void loadLinkDrivers(link, id);
                }}
            />
        );
    }

    return (
        <OsSheet
            title="Transportador e motorista"
            subtitle={link ? link.name : 'Escolha quem leva esta viagem'}
            onClose={onClose}
            footer={
                <>
                    {error ? (
                        <p className="mb-3 rounded-lg bg-brand-red-500/10 p-3 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">
                            {error}
                        </p>
                    ) : null}
                    {creating ? null : (
                        <>
                            <OsButton full disabled={!link || busy} onClick={() => void save()}>
                                {busy ? 'Salvando…' : 'Usar este transportador'}
                            </OsButton>
                            {link ? (
                                <OsButton full variant="ghost" className="mt-1" disabled={busy} onClick={() => void save(true)}>
                                    Usar e completar cadastro (CIOT/MDF-e)
                                </OsButton>
                            ) : null}
                        </>
                    )}
                </>
            }
        >
            {creating ? (
                <NewCarrierForm manifestId={manifestId} onCreated={openRegistry} onUsed={onSaved} onCancel={() => setCreating(false)} />
            ) : !link ? (
                <>
                    <OsButton full variant="secondary" className="mb-3" onClick={() => setCreating(true)}>
                        Cadastrar novo transportador
                    </OsButton>
                    <input
                        type="search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Nome, placa ou base…"
                        className={osFieldClass}
                    />
                    <div className="mt-2 flex flex-col gap-2">
                        {filtered.length === 0 ? <OsEmpty title="Nenhum transportador aprovado encontrado" /> : null}
                        {filtered.map((l) => (
                            <button
                                key={l.id}
                                type="button"
                                onClick={() => setLink(l)}
                                className="flex min-h-[56px] flex-col justify-center rounded-xl border border-tower-200 bg-white px-3.5 text-left active:bg-tower-50 dark:border-tower-700 dark:bg-tower-900 dark:active:bg-tower-800"
                            >
                                <span className="text-[14px] font-semibold text-tower-900 dark:text-white">{l.name}</span>
                                <span className="text-[12px] text-tower-500 dark:text-tower-400">
                                    {linkCompositionPlates(l).traction ?? 'sem placa'} · {l.homeBase}
                                    {l.approvalStatus === 'PENDING' ? ' · pendente (será aprovado ao usar)' : ''}
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            ) : (
                <>
                    <button type="button" onClick={() => setLink(null)} className="text-[13px] font-bold text-brand-600 dark:text-brand-300">
                        Trocar transportador
                    </button>

                    <p className="mb-1.5 mt-4 text-[13px] font-bold text-tower-600 dark:text-tower-300">Veículo desta viagem</p>
                    <PlatePicker label="Cavalo" role="TRACTION" value={traction} onChange={setTraction} />
                    {[0, 1, 2].slice(0, Math.min(3, trailers.length + 1)).map((index) => (
                        <PlatePicker
                            key={index}
                            label={`Implemento ${index + 1}`}
                            role="TRAILER"
                            value={trailers[index] ?? ''}
                            onChange={(plate) =>
                                setTrailers((list) => {
                                    const next = [...list];
                                    next[index] = plate;
                                    return next;
                                })
                            }
                            onClear={trailers[index] ? () => setTrailers((list) => list.filter((_, i) => i !== index)) : undefined}
                        />
                    ))}
                    <p className="mt-1.5 text-[12px] text-tower-500 dark:text-tower-400">
                        Cavalo e implementos valem só para esta viagem; o motorista não depende deles.
                    </p>

                    <p className="mb-1.5 mt-4 text-[13px] font-bold text-tower-600 dark:text-tower-300">Motorista</p>
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
                                {driverQ.trim().length >= 2
                                    ? 'Nenhum motorista encontrado.'
                                    : 'Nenhum motorista neste transportador — busque por nome/CPF ou cadastre.'}
                            </p>
                        ) : null}
                        {driverRows.map((d) => {
                            const cnh = cnhStatus(d.cnhExpiry);
                            return (
                                <label
                                    key={d.id}
                                    className={clsx(
                                        'flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border-2 p-3',
                                        driverId === d.id ? 'border-brand-500 bg-brand-500/8' : 'border-tower-200 dark:border-tower-700',
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name="driver"
                                        checked={driverId === d.id}
                                        onChange={() => setDriverId(d.id)}
                                        className="h-5 w-5 accent-[#2e3192]"
                                    />
                                    <span className="flex min-w-0 flex-col">
                                        <span className="text-[14px] font-semibold text-tower-900 dark:text-white">{d.name}</span>
                                        <span className="text-[12px] text-tower-500 dark:text-tower-400">
                                            CPF {d.document}
                                            {driverBelongsToLink(d, link.id) ? '' : ' · de outro transportador (será vinculado)'}
                                        </span>
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
                                </label>
                            );
                        })}
                    </div>
                    <OsButton full variant="secondary" className="mt-3" onClick={() => setNewDriver(true)}>
                        Cadastrar motorista
                    </OsButton>
                </>
            )}
        </OsSheet>
    );
};

export default ResponsibleEditor;
