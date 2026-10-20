import React, { useEffect, useState } from 'react';
import { hubCoverageApi, locationsApi } from '../../../lib/api';
import { useOs } from '../OsContext';
import { OsActionBar, OsButton, OsEmpty, OsErrorNotice, OsSectionTitle, OsSkeletonRows } from '../ui/kit';
import { IconX } from '../ui/icons';

/**
 * COBERTURA — a tabela de roteamento do hub (só modo torre/ADMIN).
 * Cada cidade aqui faz pedidos com esse destino caírem na fila "→ este hub"
 * nos demais hubs. Prioridade menor vence quando dois hubs cobrem a mesma cidade.
 */

interface Draft {
    cityIbgeCode: string;
    cityName: string;
    state: string;
    leadTimeDays: string;
    priority: string;
}

interface CityHit {
    ibgeCode: string;
    name: string;
    state?: { code: string };
}

const CoveragePage: React.FC = () => {
    const { hubId, hub, isAdmin } = useOs();
    const [rows, setRows] = useState<Draft[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const [q, setQ] = useState('');
    const [hits, setHits] = useState<CityHit[]>([]);

    useEffect(() => {
        if (!hubId) return;
        let cancelled = false;
        hubCoverageApi
            .list(hubId)
            .then((body) => {
                if (cancelled) return;
                setRows(
                    (body.data ?? []).map((e) => ({
                        cityIbgeCode: e.cityIbgeCode,
                        cityName: e.cityName,
                        state: e.state,
                        leadTimeDays: e.leadTimeDays != null ? String(e.leadTimeDays) : '',
                        priority: String(e.priority),
                    })),
                );
            })
            .catch(() => !cancelled && setError('Não foi possível carregar a cobertura.'))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [hubId]);

    useEffect(() => {
        const term = q.trim();
        if (term.length < 3) {
            setHits([]);
            return;
        }
        const timer = window.setTimeout(() => {
            locationsApi
                .getCities({ q: term })
                .then((body) => setHits(((body.data ?? []) as CityHit[]).slice(0, 8)))
                .catch(() => setHits([]));
        }, 300);
        return () => window.clearTimeout(timer);
    }, [q]);

    if (!isAdmin) {
        return <OsEmpty title="Cobertura é configurada pela torre" detail="Peça à gestão para ajustar as cidades atendidas por este hub." />;
    }
    if (loading) return <OsSkeletonRows />;

    const add = (city: CityHit) => {
        if (rows.some((r) => r.cityIbgeCode === city.ibgeCode)) return;
        setRows((prev) => [
            ...prev,
            { cityIbgeCode: city.ibgeCode, cityName: city.name, state: city.state?.code ?? '', leadTimeDays: '', priority: '100' },
        ]);
        setQ('');
        setHits([]);
        setSaved(false);
    };

    const patch = (code: string, field: 'leadTimeDays' | 'priority', value: string) => {
        setRows((prev) => prev.map((r) => (r.cityIbgeCode === code ? { ...r, [field]: value.replace(/\D/g, '') } : r)));
        setSaved(false);
    };

    const save = async () => {
        if (!hubId || saving) return;
        setSaving(true);
        setError(null);
        try {
            await hubCoverageApi.replace(
                hubId,
                rows.map((r) => ({
                    cityIbgeCode: r.cityIbgeCode,
                    priority: Number(r.priority) || 100,
                    ...(r.leadTimeDays ? { leadTimeDays: Number(r.leadTimeDays) } : {}),
                })),
            );
            setSaved(true);
        } catch {
            setError('Não foi possível salvar a cobertura. Confira os valores e tente de novo.');
        } finally {
            setSaving(false);
        }
    };

    const inputCls =
        'h-[40px] w-full rounded-lg border-2 border-tower-200 bg-white px-2 text-center text-[14px] text-tower-900 focus:border-brand-400 focus:outline-none dark:border-tower-600 dark:bg-tower-800 dark:text-white';

    return (
        <div className="pb-36">
            <OsSectionTitle>Cobertura de {hub?.name ?? 'hub'}</OsSectionTitle>
            <p className="mb-3 text-[13px] leading-relaxed text-tower-500 dark:text-tower-400">
                Cidades que este hub atende como próximo salto. A cidade-sede já conta automaticamente. Prioridade
                menor vence quando dois hubs cobrem a mesma cidade.
            </p>

            <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Adicionar cidade (mín. 3 letras)…"
                className="h-[48px] w-full rounded-xl border-2 border-tower-200 bg-white px-3.5 text-[15px] text-tower-900 placeholder:text-tower-400 focus:border-brand-400 focus:outline-none dark:border-tower-600 dark:bg-tower-900 dark:text-white"
            />
            {hits.length > 0 ? (
                <div className="mt-1 overflow-hidden rounded-xl border border-tower-200 bg-white dark:border-tower-700 dark:bg-tower-900">
                    {hits.map((c) => (
                        <button
                            key={c.ibgeCode}
                            type="button"
                            onClick={() => add(c)}
                            className="block min-h-[44px] w-full border-b border-tower-100 px-3.5 text-left text-[14px] last:border-0 active:bg-tower-50 dark:border-tower-800 dark:active:bg-tower-800"
                        >
                            {c.name}/{c.state?.code} <span className="font-mono text-[12px] text-tower-400">{c.ibgeCode}</span>
                        </button>
                    ))}
                </div>
            ) : null}

            {error ? <div className="mt-3"><OsErrorNotice message={error} /></div> : null}

            <div className="mt-4 flex flex-col gap-2">
                {rows.length === 0 ? (
                    <OsEmpty title="Só a cidade-sede" detail="Adicione as cidades que este hub distribui." />
                ) : (
                    <>
                        <div className="grid grid-cols-[1fr_64px_64px_40px] gap-2 px-1 text-[11px] font-bold text-tower-400">
                            <span>Cidade</span>
                            <span className="text-center">Prazo (d)</span>
                            <span className="text-center">Prioridade</span>
                            <span />
                        </div>
                        {rows.map((r) => (
                            <div key={r.cityIbgeCode} className="grid grid-cols-[1fr_64px_64px_40px] items-center gap-2 rounded-xl border border-tower-200 bg-white p-2 dark:border-tower-700 dark:bg-tower-900">
                                <span className="truncate pl-1 text-[14px] font-semibold text-tower-900 dark:text-white">
                                    {r.cityName}/{r.state}
                                </span>
                                <input inputMode="numeric" value={r.leadTimeDays} onChange={(e) => patch(r.cityIbgeCode, 'leadTimeDays', e.target.value)} className={inputCls} />
                                <input inputMode="numeric" value={r.priority} onChange={(e) => patch(r.cityIbgeCode, 'priority', e.target.value)} className={inputCls} />
                                <button
                                    type="button"
                                    aria-label={`Remover ${r.cityName}`}
                                    onClick={() => {
                                        setRows((prev) => prev.filter((x) => x.cityIbgeCode !== r.cityIbgeCode));
                                        setSaved(false);
                                    }}
                                    className="flex h-10 w-10 items-center justify-center rounded-lg text-tower-400 active:bg-tower-100 dark:active:bg-tower-800"
                                >
                                    <IconX size={18} />
                                </button>
                            </div>
                        ))}
                    </>
                )}
            </div>

            <OsActionBar>
                <OsButton full disabled={saving} onClick={() => void save()}>
                    {saving ? 'Salvando…' : saved ? 'Cobertura salva' : `Salvar cobertura (${rows.length} cidade(s))`}
                </OsButton>
            </OsActionBar>
        </div>
    );
};

export default CoveragePage;
