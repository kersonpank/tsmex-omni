import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ColumnPreferencesState {
  hiddenColumnsByTable: Record<string, string[]>;
  columnOrderByTable: Record<string, string[]>;
  pinnedColumnsByTable: Record<string, string[]>;
  isColumnHidden: (tableId: string, columnId: string) => boolean;
  setColumnVisible: (tableId: string, columnId: string, visible: boolean) => void;
  setColumnOrder: (tableId: string, orderedIds: string[]) => void;
  togglePinned: (tableId: string, columnId: string) => void;
  resetTable: (tableId: string) => void;
}

export const useColumnPreferencesStore = create<ColumnPreferencesState>()(
  persist(
    (set, get) => ({
      hiddenColumnsByTable: {},
      columnOrderByTable: {},
      pinnedColumnsByTable: {},
      isColumnHidden: (tableId, columnId) => (get().hiddenColumnsByTable[tableId] ?? []).includes(columnId),
      setColumnVisible: (tableId, columnId, visible) =>
        set((state) => {
          const current = new Set(state.hiddenColumnsByTable[tableId] ?? []);
          if (visible) current.delete(columnId);
          else current.add(columnId);
          return { hiddenColumnsByTable: { ...state.hiddenColumnsByTable, [tableId]: [...current] } };
        }),
      setColumnOrder: (tableId, orderedIds) =>
        set((state) => ({
          columnOrderByTable: { ...state.columnOrderByTable, [tableId]: [...orderedIds] },
        })),
      togglePinned: (tableId, columnId) =>
        set((state) => {
          const current = new Set(state.pinnedColumnsByTable[tableId] ?? []);
          if (current.has(columnId)) current.delete(columnId);
          else current.add(columnId);
          return { pinnedColumnsByTable: { ...state.pinnedColumnsByTable, [tableId]: [...current] } };
        }),
      resetTable: (tableId) =>
        set((state) => {
          const { [tableId]: _removedHidden, ...restHidden } = state.hiddenColumnsByTable;
          const { [tableId]: _removedOrder, ...restOrder } = state.columnOrderByTable;
          const { [tableId]: _removedPinned, ...restPinned } = state.pinnedColumnsByTable;
          return {
            hiddenColumnsByTable: restHidden,
            columnOrderByTable: restOrder,
            pinnedColumnsByTable: restPinned,
          };
        }),
    }),
    {
      name: 'column-preferences-store-v2',
      partialize: (state) => ({
        hiddenColumnsByTable: state.hiddenColumnsByTable,
        columnOrderByTable: state.columnOrderByTable,
        pinnedColumnsByTable: state.pinnedColumnsByTable,
      }),
    }
  )
);
