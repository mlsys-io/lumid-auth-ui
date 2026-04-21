import { create } from 'zustand';

interface AppState {
  isLoading: boolean;
  theme: 'light' | 'dark';
  sidebarOpen: boolean;
  setLoading: (loading: boolean) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  isLoading: false,
  theme: 'light',
  sidebarOpen: true,
  setLoading: (loading) => set({ isLoading: loading }),
  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}));