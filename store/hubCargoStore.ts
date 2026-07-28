import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { HubCargoBucket, HubCargoItem } from '../types/index';

interface HubCargoState {
    hubId: string | null;
    bucket: HubCargoBucket;
    query: string;
    selectedOrderIds: string[];
    selectedItems: Record<string, HubCargoItem>;
    setHub: (hubId: string | null) => void;
    setBucket: (bucket: HubCargoBucket) => void;
    setQuery: (query: string) => void;
    toggleOrder: (item: HubCargoItem) => void;
    addOrder: (item: HubCargoItem) => void;
    removeOrder: (orderId: string) => void;
    replaceSelection: (orderIds: string[]) => void;
    clearSelection: () => void;
}

export const useHubCargoStore = create<HubCargoState>()(
    persist(
        (set) => ({
            hubId: null,
            bucket: 'stock',
            query: '',
            selectedOrderIds: [],
            selectedItems: {},
            setHub: (hubId) =>
                set((state) =>
                    state.hubId === hubId
                        ? state
                        : {
                              hubId,
                              bucket: 'stock',
                              query: '',
                              selectedOrderIds: [],
                              selectedItems: {},
                          },
                ),
            setBucket: (bucket) => set({ bucket }),
            setQuery: (query) => set({ query }),
            toggleOrder: (item) =>
                set((state) => {
                    const orderId = item.orderId ?? item.id;
                    if (state.selectedOrderIds.includes(orderId)) {
                        const selectedItems = { ...state.selectedItems };
                        delete selectedItems[orderId];
                        return {
                            selectedOrderIds: state.selectedOrderIds.filter((id) => id !== orderId),
                            selectedItems,
                        };
                    }
                    return {
                        selectedOrderIds: [...state.selectedOrderIds, orderId],
                        selectedItems: { ...state.selectedItems, [orderId]: item },
                    };
                }),
            addOrder: (item) =>
                set((state) => {
                    const orderId = item.orderId ?? item.id;
                    return {
                        selectedOrderIds: state.selectedOrderIds.includes(orderId)
                            ? state.selectedOrderIds
                            : [...state.selectedOrderIds, orderId],
                        selectedItems: { ...state.selectedItems, [orderId]: item },
                    };
                }),
            removeOrder: (orderId) =>
                set((state) => {
                    const selectedItems = { ...state.selectedItems };
                    delete selectedItems[orderId];
                    return {
                        selectedOrderIds: state.selectedOrderIds.filter((id) => id !== orderId),
                        selectedItems,
                    };
                }),
            replaceSelection: (selectedOrderIds) =>
                set((state) => ({
                    selectedOrderIds,
                    selectedItems: Object.fromEntries(
                        selectedOrderIds
                            .map((id) => [id, state.selectedItems[id]] as const)
                            .filter((entry): entry is readonly [string, HubCargoItem] => Boolean(entry[1])),
                    ),
                })),
            clearSelection: () => set({ selectedOrderIds: [], selectedItems: {} }),
        }),
        {
            name: 'hub-cargo-session',
            storage: createJSONStorage(() => sessionStorage),
        },
    ),
);
