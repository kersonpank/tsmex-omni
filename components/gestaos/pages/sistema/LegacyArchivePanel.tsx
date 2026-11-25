import React, { useState } from 'react';
import { legacyArchiveApi, type LegacyArchiveRow } from '../../../../lib/api';
import { relative } from '../../lib/format';
import { invalidate, useResource } from '../../lib/resource';
import { Button, EmptyState, Field, Loadable, Panel, Pill, SelectInput, Skeleton, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/overlay';

function readText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error(`Não foi possível ler ${file.name}.`));
        reader.readAsText(file, 'utf-8');
    });
}

/** Resumo de uma linha do legado: os primeiros campos preenchidos, para reconhecer o registro. */
const preview = (data: Record<string, unknown>) =>
    Object.entries(data)
        .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
        .slice(0, 6)
        .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
        .join(' · ');

/**
 * Histórico do sistema legado: tudo que foi exportado de lá (pessoas, pedidos, viagens, CT-e,
 * financeiro…), guardado como veio. É o que continua consultável depois que a assinatura acabar.
 */
export const LegacyArchivePanel: React.FC = () => {
    const summary = useResource('system:legacy-summary', async () => (await legacyArchiveApi.summary()).data ?? [], { staleMs: 30_000 });
    const [entity, setEntity] = useState('');
    const [q, setQ] = useState('');
    const [query, setQuery] = useState({ entity: '', q: '' });
    const [open, setOpen] = useState<string | null>(null);
    const [importEntity, setImportEntity] = useState('');
    const [result, setResult] = useState<string | null>(null);
    const { busy, run } = useAction();
    const results = useResource(
        query.q || query.entity ? `system:legacy-search:${query.entity}:${query.q}` : null,
        async () => (await legacyArchiveApi.search({ entity: query.entity || undefined, q: query.q || undefined, pageSize: 30 })).data,
        { staleMs: 10_000 },
    );

    const importFile = async (file: File | undefined) => {
        if (!file || !importEntity.trim()) return;
        let msg = '';
        const ok = await run('legacy-import', async () => {
            const r = (await legacyArchiveApi.importFile({ entity: importEntity.trim(), content: await readText(file), fileName: file.name })).data;
            msg = `${file.name}: ${r.total} linhas → ${r.created} novas, ${r.updated} alteradas, ${r.unchanged} iguais (chave: ${r.keyColumn ?? 'hash da linha'})`;
        }, { success: 'Arquivo guardado no histórico.', error: 'O arquivo não foi importado.' });
        if (ok) { setResult(msg); invalidate('system:legacy-'); }
    };

    return (
        <Panel
            title="Histórico do legado"
            hint="Tudo que foi exportado do sistema legado, guardado como veio e pesquisável por nome, CNPJ/CPF, número ou chave. Cargas grandes: extrator e script no servidor."
            mode="manual"
        >
            <Loadable state={summary} skeleton={<Skeleton rows={2} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="Nada importado ainda." hint="Rode o extrator do legado e carregue as pastas com o script, ou importe um arquivo abaixo." />}>
                {(list) => (
                    <div className="mb-4 flex flex-wrap gap-2">
                        {list.map((s) => (
                            <button key={s.entity} type="button" onClick={() => { setEntity(s.entity); setQuery({ entity: s.entity, q }); }}>
                                <Pill tone={query.entity === s.entity ? 'solid' : 'neutral'} title={s.lastImportAt ? `atualizado ${relative(s.lastImportAt)}` : undefined}>{s.entity} · {s.count}</Pill>
                            </button>
                        ))}
                    </div>
                )}
            </Loadable>

            <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setQuery({ entity, q: q.trim() }); }}>
                <Field label="Tipo" className="w-44">
                    <SelectInput value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Tipo do histórico">
                        <option value="">Todos</option>
                        {(summary.data ?? []).map((s) => <option key={s.entity} value={s.entity}>{s.entity}</option>)}
                    </SelectInput>
                </Field>
                <Field label="Buscar (nome, CNPJ/CPF, número, chave)" className="min-w-[220px] flex-1">
                    <TextInput value={q} onChange={(e) => setQ(e.target.value)} />
                </Field>
                <Button type="submit" size="sm" className="self-end">Buscar</Button>
            </form>

            {results.data ? (
                <div className="mb-4">
                    <p className="gx-muted mb-2 text-[12.5px]">{results.data.total} registro(s){results.data.total > results.data.rows.length ? `, mostrando ${results.data.rows.length}` : ''}.</p>
                    <ul>
                        {results.data.rows.map((r: LegacyArchiveRow) => (
                            <li key={r.id} className="gx-hair-b py-2.5 last:border-b-0">
                                <button type="button" className="w-full text-left" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                                    <span className="font-semibold">{r.entity} {r.legacyKey.startsWith('h:') ? '' : r.legacyKey}</span>
                                    {r.revisions > 0 ? <span className="gx-muted ml-2 text-[12px]">{r.revisions} alteração(ões)</span> : null}
                                    <span className="gx-muted block truncate text-[12.5px]">{preview(r.data)}</span>
                                </button>
                                {open === r.id ? <pre className="gx-inset mt-2 max-h-80 overflow-auto p-3 text-[12px]">{JSON.stringify(r.data, null, 2)}</pre> : null}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            <div className="flex flex-wrap items-end gap-2">
                <Field label="Importar arquivo (CSV ou JSON) como tipo" className="w-56">
                    <TextInput value={importEntity} onChange={(e) => setImportEntity(e.target.value)} placeholder="ex.: titulos" />
                </Field>
                <label className={`gx-btn gx-btn-soft gx-btn-sm ${importEntity.trim() ? 'cursor-pointer' : 'pointer-events-none opacity-50'}`}>
                    {busy === 'legacy-import' ? 'Importando…' : 'Escolher arquivo'}
                    <input type="file" accept=".csv,.json,.txt,text/csv,application/json" className="sr-only" aria-label="Arquivo do legado" disabled={!importEntity.trim() || busy === 'legacy-import'} onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
            </div>
            {result ? <p className="mt-2 text-[13.5px]">{result}</p> : null}
        </Panel>
    );
};
