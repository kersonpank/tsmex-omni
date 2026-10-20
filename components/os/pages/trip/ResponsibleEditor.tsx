import React, { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { linksApi, manifestsApi } from '../../../../lib/api';
import type { Driver, Link } from '../../../../types/index';
import { linkCompositionPlates } from '../../lib/trip';
import { OsButton, OsEmpty } from '../../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../../ui/Sheet';

/**
 * Transportador e motorista da viagem: escolhe um transportador aprovado, o motorista
 * dele e confirma o veículo cadastrado do transportador (só placas — o resto é cadastro).
 * Duas escritas pelo backend existente: responsável (transportador + motorista) e composição (placas).
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
    const [driverId, setDriverId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

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

    useEffect(() => {
        if (!link) return;
        setDrivers([]);
        setDriverId(null);
        linksApi
            .getDrivers(link.id)
            .then((body) => {
                const rows = (Array.isArray(body.data) ? body.data : []).filter((d) => d.active !== false);
                setDrivers(rows);
                if (rows.length === 1) setDriverId(rows[0].id);
            })
            .catch(() => setDrivers([]));
    }, [link]);

    const filtered = useMemo(() => {
        const term = q.trim().toLowerCase();
        if (!term) return links.slice(0, 30);
        return links
            .filter((l) => `${l.name} ${l.vehiclePlate ?? ''} ${l.homeBase ?? ''}`.toLowerCase().includes(term))
            .slice(0, 30);
    }, [links, q]);

    const plates = link ? linkCompositionPlates(link) : null;

    const save = async () => {
        if (!link || busy) return;
        setBusy(true);
        setError(null);
        try {
            await manifestsApi.setResponsible(manifestId, link.id, driverId);
            if (plates?.traction) {
                await manifestsApi.setVehicles(manifestId, {
                    traction: { plate: plates.traction },
                    trailers: plates.trailers.map((plate) => ({ plate })),
                });
            }
            onSaved();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível salvar o transportador.'));
            setBusy(false);
        }
    };

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
                    <OsButton full disabled={!link || busy} onClick={() => void save()}>
                        {busy ? 'Salvando…' : 'Usar este transportador'}
                    </OsButton>
                </>
            }
        >
            {!link ? (
                <>
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

                    <p className="mb-1.5 mt-4 text-[13px] font-bold text-tower-600 dark:text-tower-300">Veículo</p>
                    {plates?.traction ? (
                        <p className="rounded-xl bg-tower-100 p-3 font-mono text-[14px] text-tower-800 dark:bg-tower-800 dark:text-tower-100">
                            {[plates.traction, ...plates.trailers].join(' + ')}
                        </p>
                    ) : (
                        <p className="rounded-xl bg-brand-yellow-400/20 p-3 text-[13px] text-[#6b5900] dark:text-brand-yellow-400">
                            Este transportador não tem placa cadastrada. Salve e complete o veículo em "Cadastro do veículo e motorista".
                        </p>
                    )}

                    <p className="mb-1.5 mt-4 text-[13px] font-bold text-tower-600 dark:text-tower-300">Motorista</p>
                    {drivers.length === 0 ? (
                        <p className="text-[13px] text-tower-500 dark:text-tower-400">
                            Nenhum motorista ativo neste transportador — cadastre em "Cadastro do veículo e motorista".
                        </p>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {drivers.map((d) => (
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
                                    <span className="text-[14px] font-semibold text-tower-900 dark:text-white">{d.name}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </>
            )}
        </OsSheet>
    );
};

export default ResponsibleEditor;
