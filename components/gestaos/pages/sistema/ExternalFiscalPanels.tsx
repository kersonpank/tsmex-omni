import React, { useState } from 'react';
import { externalFiscalApi, type EmitterNumberingStatus, type ExternalFiscalDocumentRow, type NumberingSeriesRow } from '../../../../lib/api';
import { invalidate, useResource } from '../../lib/resource';
import { formatCnpjCpf } from '../../ui/form';
import { Button, EmptyState, Field, Loadable, Panel, Pill, Skeleton, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/overlay';

const MODEL_LABEL = { CTE: 'CT-e', MDFE: 'MDF-e' } as const;
const STATUS_LABEL = { AUTHORIZED: 'Autorizado', CANCELLED: 'Cancelado', CLOSED: 'Encerrado' } as const;
const WARNING_TEXT: Record<NumberingSeriesRow['warnings'][number], string> = {
    SAME_SERIES_AS_LEGACY: 'O legado também usou esta série. Use uma série só do TSM.',
    LEGACY_AHEAD: 'O legado já passou do último número do TSM nesta série: o TSM vai pular números.',
    LEGACY_ACTIVE_RECENTLY: 'O legado emitiu nesta série nos últimos 30 dias.',
};
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

const SeriesLine: React.FC<{ row: NumberingSeriesRow }> = ({ row }) => (
    <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{MODEL_LABEL[row.model]} série {row.series}</span>
            <span className="gx-muted text-[13px]">TSM: último {row.tsmLastNumber}</span>
            <span className="gx-muted text-[13px]">· legado: {row.legacyLastNumber ?? 'nenhum'}{row.legacyLastNumber != null ? ` (${row.legacyCount} docs, último em ${date(row.legacyLastIssuedAt)})` : ''}</span>
            {row.warnings.length === 0 ? <Pill tone="neutral" dot>Série livre</Pill> : <Pill tone="red" dot>Conflito com o legado</Pill>}
        </div>
        {row.warnings.map((w) => <p key={w} className="gx-red-text text-[13px]">{WARNING_TEXT[w]}</p>)}
    </div>
);

/** Numeração fiscal: o que o TSM vai usar × o que o legado já usou (mesmo CNPJ e ambiente). */
export const NumberingPanel: React.FC = () => {
    const state = useResource<EmitterNumberingStatus[]>('system:fiscal-numbering', async () => (await externalFiscalApi.numbering()).data ?? [], { staleMs: 15_000 });
    return (
        <Panel title="Numeração fiscal" hint="Cada sistema emite na sua série. Confira aqui antes de passar um emitente para produção e no dia do corte." mode="manual">
            <Loadable state={state} skeleton={<Skeleton rows={2} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="Nenhum emitente ativo." />}>
                {(list) => (
                    <ul className="flex flex-col gap-4">
                        {list.map((e) => (
                            <li key={e.emitterId} className="gx-inset flex flex-col gap-3 px-4 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-semibold">{e.name}</p>
                                    <span className="gx-mono gx-muted text-[12.5px]">{formatCnpjCpf(e.cnpj)}</span>
                                    <Pill tone={e.environment === 'PRODUCAO' ? 'solid' : 'yellow'}>{e.environment === 'PRODUCAO' ? 'Produção' : 'Homologação'}</Pill>
                                </div>
                                <SeriesLine row={e.cte} />
                                <SeriesLine row={e.mdfe} />
                                {e.legacySeries.length > 0 ? (
                                    <p className="gx-muted text-[12.5px]">Séries usadas pelo legado neste CNPJ: {e.legacySeries.map((s) => `${MODEL_LABEL[s.model]} ${s.series} (até ${s.lastNumber})`).join(' · ')}</p>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                )}
            </Loadable>
        </Panel>
    );
};

function readText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error(`Não foi possível ler ${file.name}.`));
        reader.readAsText(file, 'utf-8');
    });
}

async function readFiles(files: FileList): Promise<Array<{ name: string; xml: string }>> {
    return Promise.all([...files].map(async (f) => ({ name: f.name, xml: await readText(f) })));
}

const BATCH = 50;

/** Arquivo fiscal externo: XMLs do legado (histórico e contingência). Carga grande: script no servidor. */
export const ExternalArchivePanel: React.FC = () => {
    const [q, setQ] = useState('');
    const [query, setQuery] = useState('');
    const [summary, setSummary] = useState<string | null>(null);
    const { busy, run } = useAction();
    const docs = useResource<{ rows: ExternalFiscalDocumentRow[]; total: number }>(
        `system:fiscal-external:${query}`,
        async () => {
            const res = await externalFiscalApi.list({ q: query || undefined, pageSize: 30 });
            return { rows: res.data ?? [], total: res.total ?? 0 };
        },
        { staleMs: 10_000 },
    );

    const importFiles = async (list: FileList | null) => {
        if (!list || list.length === 0) return;
        const totals: Record<string, number> = {};
        const ok = await run('import', async () => {
            const files = await readFiles(list);
            for (let i = 0; i < files.length; i += BATCH) {
                const res = await externalFiscalApi.importXml(files.slice(i, i + BATCH));
                for (const [k, v] of Object.entries(res.data?.counts ?? {})) totals[k] = (totals[k] ?? 0) + (v ?? 0);
            }
        }, { success: 'XMLs processados.', error: 'A importação parou.' });
        const labels: Record<string, string> = { created: 'novos', duplicate: 'já existiam', 'own-document': 'emitidos pelo TSM', 'event-applied': 'eventos aplicados', 'event-duplicate': 'eventos repetidos', 'event-orphan': 'eventos sem documento', rejected: 'recusados' };
        setSummary(Object.entries(totals).map(([k, v]) => `${v} ${labels[k] ?? k}`).join(' · ') || null);
        if (ok) invalidate('system:fiscal-');
    };

    const download = (accessKey: string) =>
        run(`xml:${accessKey}`, async () => {
            const blob = await externalFiscalApi.downloadXml(accessKey);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${accessKey}.xml`;
            a.click();
            URL.revokeObjectURL(url);
        }, { success: 'XML baixado.', error: 'O XML não foi baixado.' });

    return (
        <Panel
            title="Arquivo fiscal externo"
            hint="CT-e e MDF-e emitidos fora do TSM (legado, contingência). Guardados com o XML original e usados para o TSM nunca repetir número. Para milhares de arquivos, use o script de carga no servidor."
            mode="manual"
            actions={
                <label className="gx-btn gx-btn-soft gx-btn-sm cursor-pointer">
                    {busy === 'import' ? 'Importando…' : 'Importar XMLs'}
                    <input type="file" accept=".xml,text/xml,application/xml" multiple className="sr-only" disabled={busy === 'import'} aria-label="Arquivos XML" onChange={(e) => { void importFiles(e.target.files); e.target.value = ''; }} />
                </label>
            }
        >
            {summary ? <p className="mb-3 text-[13.5px]">{summary}</p> : null}
            <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
                <Field label="Buscar por chave, número ou CNPJ/CPF de parte" className="flex-1">
                    <TextInput value={q} onChange={(e) => setQ(e.target.value)} className="gx-mono" />
                </Field>
                <Button type="submit" size="sm" className="self-end">Buscar</Button>
            </form>
            <Loadable state={docs} skeleton={<Skeleton rows={3} />} isEmpty={(d) => d.rows.length === 0} empty={<EmptyState title="Nenhum documento externo." hint="Importe os XMLs do legado (histórico e contingência)." />}>
                {(d) => (
                    <>
                        <p className="gx-muted mb-2 text-[12.5px]">{d.total} documento(s){d.total > d.rows.length ? `, mostrando ${d.rows.length}` : ''}.</p>
                        <ul>
                            {d.rows.map((r) => (
                                <li key={r.id} className="gx-hair-b flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 last:border-b-0">
                                    <span className="font-semibold">{MODEL_LABEL[r.model]} {r.series}-{r.number}</span>
                                    <span className="gx-muted text-[12.5px]">{date(r.issuedAt)}</span>
                                    <Pill tone={r.status === 'CANCELLED' ? 'red' : 'neutral'}>{STATUS_LABEL[r.status]}</Pill>
                                    {r.environment === 'HOMOLOGACAO' ? <Pill tone="yellow">Homologação</Pill> : null}
                                    <span className="gx-mono gx-muted min-w-0 flex-1 truncate text-[12px]">{r.accessKey}</span>
                                    <Button size="sm" loading={busy === `xml:${r.accessKey}`} onClick={() => void download(r.accessKey)}>XML</Button>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </Loadable>
        </Panel>
    );
};
