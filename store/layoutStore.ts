import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LayoutState {
  sidebarCollapsed: boolean;
  sidebarDrawerOpen: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarDrawerOpen: (open: boolean) => void;
  toggleSidebarDrawer: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarCollapsed: true,
      sidebarDrawerOpen: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarDrawerOpen: (open) => set({ sidebarDrawerOpen: open }),
      toggleSidebarDrawer: () => set((state) => ({ sidebarDrawerOpen: !state.sidebarDrawerOpen })),
    }),
    {
      name: 'layout-shell-store-v1',
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    }
  )
);

