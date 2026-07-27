import React, { useEffect, useRef, useState } from 'react';
import DataTable from './DataTable';
import { useColumnPreferencesStore } from '../../store/columnPreferencesStore';

export interface ColumnDef<T> {
  id: string;
  label: string;
  render: (row: T) => React.ReactNode;
  defaultVisible: boolean;
  align?: 'left' | 'right' | 'center';
  group?: string;
}

interface ConfigurableDataTableProps<T> {
  tableId: string;
  columns: ColumnDef<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedRowId?: string | null;
  renderActions?: (row: T) => React.ReactNode;
  emptyMessage?: string;
}

// Referência estável pro fallback "sem colunas ocultas ainda" — evita criar um
// array novo a cada leitura do selector (o que disparia re-render à toa
// sempre que QUALQUER tabela mudasse de estado no store global).
const EMPTY_HIDDEN: string[] = [];

function ConfigurableDataTable<T>({
  tableId,
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedRowId,
  renderActions,
  emptyMessage = 'Nenhum registro encontrado.',
}: ConfigurableDataTableProps<T>): React.ReactElement {
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Fecha o seletor de colunas ao clicar fora (ref+mousedown, mesmo idioma
  // usado em RoleWorkspaceSwitcher/CollapsibleSection/AdminShell) e no Escape.
  useEffect(() => {
    if (!showColumnPicker) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setShowColumnPicker(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowColumnPicker(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [showColumnPicker]);

  // Seed (uma única vez por tableId): se o store persistido nunca viu essa
  // tableId, inicializa o hidden-set com os ids das colunas
  // `defaultVisible === false`. É uma leitura/escrita IMPERATIVA
  // (getState/setState), fora do ciclo reativo do React — de propósito, pois
  // só deve rodar quando a tabela é de fato nova para o usuário. Se a chave já
  // existir no store (mesmo como array vazio), respeitamos o que o usuário já
  // escolheu e não tocamos em nada.
  useEffect(() => {
    const alreadySeeded = tableId in useColumnPreferencesStore.getState().hiddenColumnsByTable;
    if (!alreadySeeded) {
      const initialHidden = columns.filter((c) => c.defaultVisible === false).map((c) => c.id);
      useColumnPreferencesStore.setState((state) => ({
        hiddenColumnsByTable: { ...state.hiddenColumnsByTable, [tableId]: initialHidden },
      }));
    }
    // Roda só quando a tableId muda — é um seed de "primeira vez", não deve
    // reagir a re-criações do array `columns` a cada render do pai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  // Leitura REATIVA: precisa re-renderizar a tabela e os checkboxes do
  // seletor assim que o usuário alterna uma coluna. Selecionamos o array de
  // ids ocultos da própria tableId — não os métodos do store (ex.:
  // `isColumnHidden`), que têm referência estável e por isso NUNCA
  // disparariam um re-render sozinhos.
  const hiddenIds = useColumnPreferencesStore((s) => s.hiddenColumnsByTable[tableId] ?? EMPTY_HIDDEN);
  const setColumnVisible = useColumnPreferencesStore((s) => s.setColumnVisible);

  const isHidden = (columnId: string) => hiddenIds.includes(columnId);
  const visibleColumns = columns.filter((c) => !isHidden(c.id));

  // Agrupar colunas pro seletor (grupo "Geral" pra quem não tem `group`)
  const groups = columns.reduce<Record<string, ColumnDef<T>[]>>((acc, col) => {
    const g = col.group ?? 'Geral';
    (acc[g] ??= []).push(col);
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-3 flex justify-end relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setShowColumnPicker((v) => !v)}
          aria-expanded={showColumnPicker}
          aria-haspopup="menu"
          aria-label="Configurar colunas visíveis"
          className="admin-focus rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
        >
          Colunas
        </button>
        {showColumnPicker && (
          <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-tower-200 bg-white p-3 shadow-lg dark:border-tower-700 dark:bg-tower-900">
            {Object.entries(groups).map(([groupName, groupCols]) => (
              <div key={groupName} className="mb-2 last:mb-0">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-tower-400">{groupName}</p>
                {groupCols.map((col) => {
                  const checked = !isHidden(col.id);
                  return (
                    <label key={col.id} className="flex items-center gap-2 py-1 text-sm text-tower-700 dark:text-tower-200">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setColumnVisible(tableId, col.id, e.target.checked)}
                        className="h-4 w-4 rounded border-tower-300"
                      />
                      {col.label}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <DataTable>
        <thead className="border-b border-tower-200 bg-tower-50/90 dark:border-tower-700 dark:bg-tower-800/80">
          <tr>
            {visibleColumns.map((col) => (
              <th
                key={col.id}
                className={`px-4 py-3 text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300 ${
                  col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                }`}
              >
                {col.label}
              </th>
            ))}
            {renderActions && (
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300">
                Ações
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-tower-100 dark:divide-tower-800">
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={visibleColumns.length + (renderActions ? 1 : 0)}
                className="px-4 py-8 text-center text-sm text-tower-500 dark:text-tower-400"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                className={`${onRowClick ? 'cursor-pointer' : ''} hover:bg-tower-50/80 dark:hover:bg-tower-800/40 ${
                  selectedRowId === key ? 'bg-brand-50/80 dark:bg-brand-950/25' : ''
                }`}
                onClick={() => onRowClick?.(row)}
              >
                {visibleColumns.map((col) => (
                  <td
                    key={col.id}
                    className={`px-4 py-3 text-sm text-tower-700 dark:text-tower-200 ${
                      col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''
                    }`}
                  >
                    {col.render(row)}
                  </td>
                ))}
                {renderActions && (
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {renderActions(row)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </DataTable>
    </div>
  );
}

export default ConfigurableDataTable;
