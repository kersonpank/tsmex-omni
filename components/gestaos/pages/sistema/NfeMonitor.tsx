import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fiscalEmittersApi, nfeDistribuicaoMonitorApi, nfeDistribuicaoTriagemApi, nfeManualInvoicesApi } from '../../../../lib/api';
import type { FiscalEmitter } from '../../../../types/index';
import { dateTime, num } from '../../lib/format';
import { invalidate, useResource } from '../../lib/resource';
import { nfeCountRows, NFE_STATUS_LABEL } from '../../lib/sistema';
import { cleanCnpjFilter, hasProblem, monitorParams, ORIGIN_LABEL, shortKey, unifyNfeRows, type NfeOrigin } from '../../lib/sistemaNfe';
import { ConfirmButton, formatCnpjCpf, SearchInput } from '../../ui/form';
import { Button, Chip, EmptyState, Field, Loadable, Panel, Pill, SelectInput, Skeleton, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/overlay';
import { NfeDetailDrawer } from './NfeDetailDrawer';

const ORIGINS: NfeOrigin[] = ['ALL', 'AUTO', 'MANUAL'];
const emitterName = (e: FiscalEmitter) => e.displayName || e.tradeName || e.person?.legalName || 'Emitente sem nome';

/** Monitor completo de NF-e: todas as situações, filtros por emitente, CNPJ e origem, detalhe e NFs lançadas à mão. */
export const NfeMonitor: React.FC = () => {
    const { busy, run } = useAction();
    const [params, setParams] = useSearchParams();
    const detailId = params.get('nfe');
    const [status, setStatus] = useState('');
    const [emitterId, setEmitterId] = useState('');
    const [cnpj, setCnpj] = useState('');
    const [origin, setOrigin] = useState<NfeOrigin>('ALL');
    const [query, setQuery] = useState('');

    const filter = { status, fiscalEmitterId: emitterId, cnpj };
    const emitters = useResource<FiscalEmitter[]>('system:emitters', async () => (await fiscalEmittersApi.list()).data ?? [], { staleMs: 60_000 });
    const auto = useResource(`system:nfe:auto:${status}:${emitterId}:${cnpj}`, async () => (await nfeDistribuicaoMonitorApi.list(monitorParams(filter))).data, { refreshMs: 120_000 });
    const manual = useResource(`system:nfe:manual:${query}`, async () => (await nfeManualInvoicesApi.list({ q: query || undefined })).data?.invoices ?? [], { staleMs: 30_000 });
    const counts = auto.data?.counts;

    const rows = useMemo(() => unifyNfeRows(auto.data?.documentos ?? [], manual.data ?? [], origin), [auto.data, manual.data, origin]);
    const openDetail = (id: string | null) =>
        setParams(
            (current) => {
                const next = new URLSearchParams(current);
                if (id) next.set('nfe', id);
                else next.delete('nfe');
                return next;
            },
            { replace: true },
        );

    const convert = async (id: string) => {
        const ok = await run(`convert:${id}`, () => nfeDistribuicaoTriagemApi.converter(id), { success: 'NF-e convertida em demanda.', error: 'Não foi possível converter a NF-e.' });
        invalidate('system:nfe', 'demands:', 'summary');
        return ok;
    };
    const discard = async (id: string) => {
        const ok = await run(`discard:${id}`, () => nfeDistribuicaoTriagemApi.descartar(id), { success: 'NF-e descartada.', error: 'Não foi possível descartar a NF-e.' });
        invalidate('system:nfe');
        return ok;
    };

    const loading = (origin !== 'MANUAL' && auto.loading && !auto.data) || (origin !== 'AUTO' && manual.loading && !manual.data);
    const error = origin !== 'MANUAL' && !auto.data ? auto.error : origin !== 'AUTO' && !manual.data ? manual.error : null;

    return (
        <div className="flex flex-col gap-6">
            <Panel title="NF-e por situação" hint="Toque numa situação para filtrar a lista. A contagem é da varredura da SEFAZ." mode="auto">
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                    {nfeCountRows(counts).map((row) => (
                        <li key={row.status}>
                            <button
                                type="button"
                                aria-pressed={status === row.status}
                                className="gx-inset w-full px-3.5 py-3 text-left"
                                style={status === row.status ? { outline: '2px solid var(--gx-royal)' } : undefined}
                                onClick={() => setStatus((current) => (current === row.status ? '' : row.status))}
                            >
                                <span className="gx-label block">{row.label}</span>
                                <span className={`gx-num mt-1 block text-[22px] ${row.tone === 'red' ? 'gx-red-text' : row.tone === 'yellow' ? 'gx-yellow-text' : ''}`}>{num(row.count)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </Panel>

            <Panel title="Notas fiscais" hint="Da varredura da SEFAZ e as lançadas à mão em pedidos. Mais recentes primeiro." padded={false}>
                <div className="flex flex-col gap-3 px-5 pb-4">
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Origem da nota">
                        {ORIGINS.map((item) => (
                            <Chip key={item} active={origin === item} onClick={() => setOrigin(item)}>
                                {ORIGIN_LABEL[item]}
                            </Chip>
                        ))}
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <Field label="Emitente ou hub">
                            <SelectInput value={emitterId} onChange={(event) => setEmitterId(event.target.value)} aria-label="Filtrar por emitente">
                                <option value="">Todos os emitentes</option>
                                {(emitters.data ?? []).map((e) => (
                                    <option key={e.id} value={e.id}>
                                        {emitterName(e)}
                                    </option>
                                ))}
                            </SelectInput>
                        </Field>
                        <Field label="CNPJ do fornecedor">
                            <TextInput inputMode="numeric" placeholder="Só números" value={cnpj} onChange={(event) => setCnpj(cleanCnpjFilter(event.target.value))} aria-label="Filtrar por CNPJ do fornecedor" />
                        </Field>
                        {origin !== 'AUTO' ? (
                            <Field label="Buscar nota lançada à mão">
                                <SearchInput onChange={setQuery} placeholder="Número, chave ou cliente" aria-label="Buscar nota lançada à mão" />
                            </Field>
                        ) : null}
                    </div>
                    {status || emitterId || cnpj ? (
                        <div>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                    setStatus('');
                                    setEmitterId('');
                                    setCnpj('');
                                }}
                            >
                                Limpar filtros{status ? ` (${NFE_STATUS_LABEL[status] ?? 'situação'})` : ''}
                            </Button>
                        </div>
                    ) : null}
                </div>

                {loading ? (
                    <Skeleton className="px-5" rows={5} height={52} />
                ) : error ? (
                    <div className="px-5 pb-5">
                        <p className="gx-red-text text-[14px]">{error}</p>
                    </div>
                ) : rows.length === 0 ? (
                    <div className="px-5 pb-5">
                        <EmptyState title="Nenhuma NF-e com esse filtro." hint="Limpe os filtros ou escolha outra origem." />
                    </div>
                ) : (
                    <div className="gx-scroll-x px-2">
                        <table className="gx-table">
                            <thead>
                                <tr>
                                    <th>Origem</th>
                                    <th>Chave ou NF</th>
                                    <th>Fornecedor ou cliente</th>
                                    <th>Emitente ou hub</th>
                                    <th>Situação</th>
                                    <th>Quando</th>
                                    <th className="text-right">Ação</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) =>
                                    row.origin === 'AUTO' ? (
                                        <tr key={row.key} data-clickable="true" onClick={() => openDetail(row.doc.id)}>
                                            <td>
                                                <Pill tone="royal">Varredura</Pill>
                                            </td>
                                            <td>
                                                <button type="button" className="gx-mono border-0 bg-transparent p-0 text-left" aria-label={`Ver detalhe da NF-e ${shortKey(row.doc.accessKey)}`} onClick={(event) => { event.stopPropagation(); openDetail(row.doc.id); }}>
                                                    {shortKey(row.doc.accessKey)}
                                                </button>
                                            </td>
                                            <td>{formatCnpjCpf(row.doc.cnpjEmitente)}</td>
                                            <td>{row.doc.fiscalEmitter.hub ? `${row.doc.fiscalEmitter.hub.code} · ${row.doc.fiscalEmitter.hub.name}` : row.doc.fiscalEmitter.displayName || '—'}</td>
                                            <td>
                                                <Pill tone={hasProblem(row.doc.status) ? 'red' : row.doc.status === 'READY_FOR_TRIAGE' ? 'yellow' : 'neutral'} dot={hasProblem(row.doc.status) || row.doc.status === 'READY_FOR_TRIAGE'}>
                                                    {NFE_STATUS_LABEL[row.doc.status] ?? 'Outra situação'}
                                                </Pill>
                                                {hasProblem(row.doc.status) && row.doc.lastError ? <span className="gx-red-text block max-w-[260px] truncate text-[12px]" title={row.doc.lastError}>{row.doc.lastError}</span> : null}
                                            </td>
                                            <td>{dateTime(row.doc.createdAt)}</td>
                                            <td className="text-right" onClick={(event) => event.stopPropagation()}>
                                                {row.doc.status === 'READY_FOR_TRIAGE' ? (
                                                    <span className="inline-flex flex-wrap justify-end gap-2">
                                                        <Button size="sm" variant="primary" loading={busy === `convert:${row.doc.id}`} disabled={busy != null && busy !== `convert:${row.doc.id}`} onClick={() => void convert(row.doc.id)} aria-label={`Converter NF-e ${shortKey(row.doc.accessKey)}`}>
                                                            Converter
                                                        </Button>
                                                        <ConfirmButton label="Descartar" confirmLabel="Descartar NF-e?" variant="ghost" disabled={busy != null} onConfirm={() => discard(row.doc.id)} />
                                                    </span>
                                                ) : row.doc.status === 'CONVERTED' && row.doc.convertedDemand ? (
                                                    <span className="gx-muted text-[13px]">Demanda {row.doc.convertedDemand.orderNumber ?? row.doc.convertedDemand.id.slice(0, 8)}</span>
                                                ) : row.doc.status === 'DISCARDED' && row.doc.discardedAt ? (
                                                    <span className="gx-muted text-[13px]">Descartada em {dateTime(row.doc.discardedAt)}</span>
                                                ) : row.doc.status === 'DISCOVERED' || row.doc.status === 'MANIFESTED' ? (
                                                    <span className="gx-muted text-[13px]">Aguardando processamento</span>
                                                ) : null}
                                            </td>
                                        </tr>
                                    ) : (
                                        <tr key={row.key}>
                                            <td>
                                                <Pill>Lançada à mão</Pill>
                                            </td>
                                            <td className="gx-mono">
                                                {row.invoice.nfNumber}
                                                {row.invoice.nfKey ? <span className="gx-muted block text-[12px]">{shortKey(row.invoice.nfKey)}</span> : null}
                                            </td>
                                            <td>{row.invoice.order.demand.client?.companyName ?? '—'}</td>
                                            <td>{row.invoice.order.currentHub ? `${row.invoice.order.currentHub.code} · ${row.invoice.order.currentHub.name}` : '—'}</td>
                                            <td>
                                                <Pill>Vinculada ao pedido</Pill>
                                            </td>
                                            <td>{dateTime(row.invoice.createdAt)}</td>
                                            <td className="text-right">
                                                <Link to={`/gestaos/pedidos?p=${row.invoice.order.id}`} className="gx-btn gx-btn-soft gx-btn-sm">
                                                    Abrir pedido
                                                </Link>
                                            </td>
                                        </tr>
                                    ),
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>
            {detailId ? <NfeDetailDrawer key={detailId} documentId={detailId} onClose={() => openDetail(null)} /> : null}
        </div>
    );
};
