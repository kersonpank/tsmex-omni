import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ColumnPreferencesState {
  hiddenColumnsByTable: Record<string, string[]>;
  isColumnHidden: (tableId: string, columnId: string) => boolean;
  setColumnVisible: (tableId: string, columnId: string, visible: boolean) => void;
  resetTable: (tableId: string) => void;
}

export const useColumnPreferencesStore = create<ColumnPreferencesState>()(
  persist(
    (set, get) => ({
      hiddenColumnsByTable: {},
      isColumnHidden: (tableId, columnId) => (get().hiddenColumnsByTable[tableId] ?? []).includes(columnId),
      setColumnVisible: (tableId, columnId, visible) =>
        set((state) => {
          const current = new Set(state.hiddenColumnsByTable[tableId] ?? []);
          if (visible) current.delete(columnId);
          else current.add(columnId);
          return { hiddenColumnsByTable: { ...state.hiddenColumnsByTable, [tableId]: [...current] } };
        }),
      resetTable: (tableId) =>
        set((state) => {
          const { [tableId]: _removed, ...rest } = state.hiddenColumnsByTable;
          return { hiddenColumnsByTable: rest };
        }),
    }),
    {
      name: 'column-preferences-store-v1',
      partialize: (state) => ({ hiddenColumnsByTable: state.hiddenColumnsByTable }),
    }
  )
);
