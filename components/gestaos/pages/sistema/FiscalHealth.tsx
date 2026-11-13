import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fiscalEmittersApi, nfeDistribuicaoMonitorApi } from '../../../../lib/api';
import type { FiscalEmitter } from '../../../../types/index';
import { dateFull } from '../../lib/format';
import { num } from '../../lib/format';
import { useResource } from '../../lib/resource';
import { ENVIRONMENT_LABEL, certificateView, nfeCountRows, sortEmitters } from '../../lib/sistema';
import { Loadable, Panel, Pill } from '../../ui/kit';

const linkClass = 'gx-btn gx-btn-soft gx-btn-sm';

/** Busca de NF-e na SEFAZ: quantas notas há em cada situação. */
export const NfeHealth: React.FC = () => {
    const state = useResource('system:nfe-counts', async () => (await nfeDistribuicaoMonitorApi.list()).data?.counts ?? {}, { refreshMs: 120_000 });
    return (
        <Panel
            title="Busca de NF-e na SEFAZ"
            hint="Notas destinadas à sua empresa, por situação."
            mode="auto"
            actions={
                <Link to="/gestao?cat=transport&sub=nfe" className={linkClass}>
                    Abrir NF-e
                </Link>
            }
        >
            <Loadable state={state}>
                {(counts) => (
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {nfeCountRows(counts).map((row) => (
                            <li key={row.status} className="gx-inset px-3.5 py-3">
                                <span className="gx-label block">{row.label}</span>
                                <span className={`gx-num mt-1 block text-[22px] ${row.tone === 'red' ? 'gx-red-text' : row.tone === 'yellow' ? 'gx-yellow-text' : ''}`}>{num(row.count)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </Loadable>
        </Panel>
    );
};

const EmitterRow: React.FC<{ emitter: FiscalEmitter }> = ({ emitter }) => {
    const cert = certificateView(emitter);
    const name = emitter.displayName || emitter.tradeName || emitter.person?.tradeName || emitter.person?.legalName || 'Emitente sem nome';
    const production = emitter.environment === 'PRODUCAO';
    return (
        <li className="gx-hair-b flex flex-wrap items-center gap-x-4 gap-y-2 py-3 last:border-b-0">
            <div className="min-w-0 flex-1 basis-48">
                <p className="truncate font-semibold">{name}</p>
                <p className="gx-muted text-[12.5px]">{emitter.active ? 'Ativo' : 'Inativo'}</p>
            </div>
            <Pill tone={production ? 'solid' : 'yellow'} title="Ambiente de emissão de CT-e e MDF-e">
                {ENVIRONMENT_LABEL[emitter.environment] ?? 'Ambiente desconhecido'}
            </Pill>
            <div className="text-right">
                <Pill tone={cert.tone} dot>
                    {cert.label}
                </Pill>
                <p className="gx-muted mt-1 text-[12.5px]">
                    {cert.detail}
                    {emitter.certificateExpiresAt ? ` (${dateFull(emitter.certificateExpiresAt)})` : ''}
                </p>
            </div>
        </li>
    );
};

/** Emitentes fiscais: ambiente bem visível e validade do certificado, pior primeiro. */
export const EmitterHealth: React.FC = () => {
    const state = useResource<FiscalEmitter[]>('system:emitters', async () => (await fiscalEmittersApi.list()).data ?? [], { staleMs: 60_000 });
    const sorted = useMemo(() => sortEmitters(state.data ?? []), [state.data]);
    return (
        <Panel
            title="Emitentes fiscais"
            hint="Quem emite CT-e e MDF-e, em qual ambiente e até quando vale o certificado."
            actions={
                <Link to="/gestao?cat=general&sub=identidade" className={linkClass}>
                    Abrir emitentes
                </Link>
            }
        >
            <Loadable state={state} isEmpty={(rows) => rows.length === 0} empty={<p className="gx-muted text-[13.5px]">Nenhum emitente cadastrado.</p>}>
                {() => <ul>{sorted.map((emitter) => <EmitterRow key={emitter.id} emitter={emitter} />)}</ul>}
            </Loadable>
        </Panel>
    );
};
