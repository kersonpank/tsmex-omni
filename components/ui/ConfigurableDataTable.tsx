import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DataTable from './DataTable';
import { useColumnPreferencesStore } from '../../store/columnPreferencesStore';

export interface ColumnDef<T> {
  id: string;
  label: string;
  render: (row: T) => React.ReactNode;
  defaultVisible: boolean;
  align?: 'left' | 'right' | 'center';
  group?: string;
  sortKey?: string;
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
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (sortKey: string) => void;
}

// Referência estável pro fallback "sem colunas ocultas ainda" — evita criar um
// array novo a cada leitura do selector (o que disparia re-render à toa
// sempre que QUALQUER tabela mudasse de estado no store global).
const EMPTY_HIDDEN: string[] = [];
// Mesma lógica de referência estável pra "sem ordem customizada ainda" e
// "nada fixado ainda".
const EMPTY_ORDER: string[] = [];
const EMPTY_PINNED: string[] = [];

// Largura fixa por coluna fixada (px). Optamos por um valor fixo em vez de
// medir a largura real via ref/useLayoutEffect: medição em runtime adiciona
// fragilidade real (resize, fontes carregando async, etc.) por um ganho
// cosmético que essa feature não precisa — colunas fixadas não precisam de
// largura pixel-perfect, só precisam parar de rolar.
const PINNED_COLUMN_WIDTH = 160;

// Linha arrastável da seção "Ordem das colunas" do popover. Mesmo padrão de
// useSortable() usado em CommercialTab.tsx (drag handle "⋮⋮" com
// attributes+listeners, transform via CSS.Transform.toString).
const SortableColumnRow: React.FC<{ id: string; label: string }> = ({ id, label }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 py-1 text-sm text-tower-700 dark:text-tower-200"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="shrink-0 rounded p-1 text-tower-400 hover:bg-tower-100 hover:text-tower-600 active:cursor-grabbing dark:text-tower-500 dark:hover:bg-tower-700 dark:hover:text-tower-300 cursor-grab touch-none"
        aria-label={`Arrastar coluna ${label}`}
      >
        <span className="text-sm leading-none select-none">⋮⋮</span>
      </button>
      <span className="truncate">{label}</span>
    </div>
  );
};

function ConfigurableDataTable<T>({
  tableId,
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedRowId,
  renderActions,
  emptyMessage = 'Nenhum registro encontrado.',
  sortBy,
  sortDir,
  onSortChange,
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
  const columnOrder = useColumnPreferencesStore((s) => s.columnOrderByTable[tableId] ?? EMPTY_ORDER);
  const pinnedIds = useColumnPreferencesStore((s) => s.pinnedColumnsByTable[tableId] ?? EMPTY_PINNED);
  const setColumnOrder = useColumnPreferencesStore((s) => s.setColumnOrder);
  const togglePinned = useColumnPreferencesStore((s) => s.togglePinned);
  const resetTable = useColumnPreferencesStore((s) => s.resetTable);

  const isHidden = (columnId: string) => hiddenIds.includes(columnId);

  // Ordem efetiva das colunas: aplica a ordem customizada salva (se houver)
  // por cima da ordem "natural" vinda das definições. Colunas que existem na
  // prop `columns` mas ainda não têm posição salva (ex.: coluna nova
  // adicionada depois que o usuário já customizou a ordem) entram no final,
  // na ordem original de definição.
  const orderedColumns = useMemo(() => {
    if (columnOrder.length === 0) return columns;
    const byId = new Map(columns.map((c) => [c.id, c]));
    const ordered: ColumnDef<T>[] = [];
    for (const id of columnOrder) {
      const col = byId.get(id);
      if (col) {
        ordered.push(col);
        byId.delete(id);
      }
    }
    for (const col of columns) {
      if (byId.has(col.id)) ordered.push(col);
    }
    return ordered;
  }, [columns, columnOrder]);

  const visibleColumns = orderedColumns.filter((c) => !isHidden(c.id));
  // Colunas fixadas vão pra frente (preservando ordem relativa entre si),
  // depois as demais visíveis (preservando ordem relativa entre si).
  const pinnedVisible = visibleColumns.filter((c) => pinnedIds.includes(c.id));
  const unpinnedVisible = visibleColumns.filter((c) => !pinnedIds.includes(c.id));
  const finalColumns = [...pinnedVisible, ...unpinnedVisible];
  // Lookup precomputado (id -> índice dentro de pinnedVisible) pra não fazer
  // findIndex a cada célula renderizada (O(linhas × colunas) em vez de
  // O(linhas × colunas × pinadas)).
  const pinnedIndexById = new Map<string, number>(pinnedVisible.map((c, i): [string, number] => [c.id, i]));

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleColumnDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visibleColumns.findIndex((c) => c.id === active.id);
    const newIndex = visibleColumns.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reorderedVisible = arrayMove<ColumnDef<T>>(visibleColumns, oldIndex, newIndex);
    const hiddenColumnIds = orderedColumns.filter((c) => isHidden(c.id)).map((c) => c.id);
    // Colunas ocultas vão pro final da ordem persistida — irrelevante enquanto
    // continuarem ocultas, mas dá uma posição inicial sensata pra quando o
    // usuário reativá-las depois.
    setColumnOrder(tableId, [...reorderedVisible.map((c) => c.id), ...hiddenColumnIds]);
  };

  // Agrupar colunas pro seletor (grupo "Geral" pra quem não tem `group`).
  // Construído com for-loop + array de pares (em vez de reduce + Object.entries)
  // porque a combinação reduce<Record<...>> + Object.entries<T> não estava
  // preservando o tipo genérico das colunas neste projeto (o overload de
  // fallback de Object.entries devolve `[string, unknown][]`) — o mesmo tipo
  // de perda de inferência genérica que já afeta `arrayMove` aqui.
  const groupOrder: string[] = [];
  const groupMap: Record<string, ColumnDef<T>[]> = {};
  for (const col of orderedColumns) {
    const g = col.group ?? 'Geral';
    if (!groupMap[g]) {
      groupMap[g] = [];
      groupOrder.push(g);
    }
    groupMap[g].push(col);
  }
  const groupEntries: [string, ColumnDef<T>[]][] = groupOrder.map((g) => [g, groupMap[g]]);

  const pinnedStyle = (pinnedIndex: number): React.CSSProperties => ({
    position: 'sticky',
    left: pinnedIndex * PINNED_COLUMN_WIDTH,
    width: PINNED_COLUMN_WIDTH,
    minWidth: PINNED_COLUMN_WIDTH,
    maxWidth: PINNED_COLUMN_WIDTH,
    zIndex: 10,
  });

  return (
    <div>
      <div className="mb-3 flex justify-end relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setShowColumnPicker((v) => !v)}
          aria-expanded={showColumnPicker}
          aria-label="Configurar colunas visíveis"
          className="admin-focus rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
        >
          Colunas
        </button>
        {showColumnPicker && (
          <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-tower-200 bg-white p-3 shadow-lg dark:border-tower-700 dark:bg-tower-900 max-h-[70vh] overflow-y-auto">
            {groupEntries.map(([groupName, groupCols]) => (
              <div key={groupName} className="mb-2 last:mb-0">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-tower-400">{groupName}</p>
                {groupCols.map((col) => {
                  const checked = !isHidden(col.id);
                  const pinned = pinnedIds.includes(col.id);
                  return (
                    <div key={col.id} className="flex items-center justify-between gap-2 py-1">
                      <label className="flex items-center gap-2 text-sm text-tower-700 dark:text-tower-200">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => setColumnVisible(tableId, col.id, e.target.checked)}
                          className="h-4 w-4 rounded border-tower-300"
                        />
                        {col.label}
                      </label>
                      <button
                        type="button"
                        onClick={() => togglePinned(tableId, col.id)}
                        aria-pressed={pinned}
                        aria-label={pinned ? `Desafixar coluna ${col.label}` : `Fixar coluna ${col.label}`}
                        title={pinned ? 'Desafixar coluna' : 'Fixar coluna'}
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          pinned
                            ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200'
                            : 'text-tower-400 hover:bg-tower-100 dark:text-tower-500 dark:hover:bg-tower-700'
                        }`}
                      >
                        {pinned ? '📌 Fixado' : '📌 Fixar'}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}

            <div className="mt-3 border-t border-tower-200 pt-2 dark:border-tower-700">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-tower-400">Ordem das colunas</p>
              {visibleColumns.length === 0 ? (
                <p className="py-1 text-xs text-tower-400">Nenhuma coluna visível.</p>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd}>
                  <SortableContext items={visibleColumns.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                    {visibleColumns.map((col) => (
                      <SortableColumnRow key={col.id} id={col.id} label={col.label} />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>

            <div className="mt-3 border-t border-tower-200 pt-2 text-right dark:border-tower-700">
              <button
                type="button"
                onClick={() => resetTable(tableId)}
                className="admin-focus text-[11px] font-semibold text-tower-400 hover:text-tower-600 dark:text-tower-500 dark:hover:text-tower-300"
              >
                Restaurar padrão
              </button>
            </div>
          </div>
        )}
      </div>

      <DataTable>
        <thead className="border-b border-tower-200 bg-tower-50/90 dark:border-tower-700 dark:bg-tower-800/80">
          <tr>
            {finalColumns.map((col) => {
              const pinnedIndex = pinnedIndexById.get(col.id);
              const isPinned = pinnedIndex !== undefined;
              return (
                <th
                  key={col.id}
                  style={isPinned ? pinnedStyle(pinnedIndex!) : undefined}
                  className={`px-4 py-3 text-xs font-bold uppercase tracking-wide text-tower-600 dark:text-tower-300 ${
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                  } ${isPinned ? 'bg-tower-50 dark:bg-tower-800' : ''}`}
                >
                  {col.sortKey && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(col.sortKey!)}
                      className="admin-focus inline-flex items-center gap-1"
                    >
                      {col.label} <span>{sortBy === col.sortKey ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
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
                colSpan={finalColumns.length + (renderActions ? 1 : 0)}
                className="px-4 py-8 text-center text-sm text-tower-500 dark:text-tower-400"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const key = rowKey(row);
            const isSelected = selectedRowId === key;
            return (
              <tr
                key={key}
                className={`${onRowClick ? 'cursor-pointer' : ''} hover:bg-tower-50/80 dark:hover:bg-tower-800/40 ${
                  isSelected ? 'bg-brand-50/80 dark:bg-brand-950/25' : ''
                }`}
                onClick={() => onRowClick?.(row)}
              >
                {finalColumns.map((col) => {
                  const pinnedIndex = pinnedIndexById.get(col.id);
                  const isPinned = pinnedIndex !== undefined;
                  // Simplificação deliberada: células fixadas NÃO acompanham o
                  // hover da linha (fundo sólido é necessário pra cobrir o
                  // conteúdo rolado por baixo, o que impede reaproveitar o
                  // hover semitransparente das células normais).
                  const pinnedBg = isPinned
                    ? isSelected
                      ? 'bg-brand-50 dark:bg-brand-950'
                      : 'bg-white dark:bg-tower-900'
                    : '';
                  return (
                    <td
                      key={col.id}
                      style={isPinned ? pinnedStyle(pinnedIndex!) : undefined}
                      className={`px-4 py-3 text-sm text-tower-700 dark:text-tower-200 ${
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''
                      } ${pinnedBg}`}
                    >
                      {/* Sem `truncate` (nowrap+ellipsis): colunas reais têm conteúdo
                          multi-linha (ex.: NF + cliente) e links clicáveis (ex.: "Ver
                          último" anexo) — forçar uma linha só corta esse conteúdo sem
                          indicador visual e pode até esconder o link. `break-words`
                          deixa o conteúdo quebrar linha normalmente dentro da largura
                          fixa, igual às colunas não fixadas já fazem. */}
                      {isPinned ? <div className="overflow-hidden break-words">{col.render(row)}</div> : col.render(row)}
                    </td>
                  );
                })}
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
