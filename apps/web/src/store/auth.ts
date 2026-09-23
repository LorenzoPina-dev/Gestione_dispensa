import { create } from "zustand";
import { getCurrentUser, logoutSession } from "../api/endpoints";
import type { UserDto } from "../api/types";

interface AuthState {
  token: string | null;
  user: UserDto | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  setToken: (token: string) => void;
  initializeAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("auth_token"),
  user: null,
  isAuthenticated: !!localStorage.getItem("auth_token"),
  isLoading: false,
  error: null,

  setToken: (token: string) => {
    localStorage.setItem("auth_token", token);
    set({ token, isAuthenticated: true });
  },

  initializeAuth: async () => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      set({ isAuthenticated: false, user: null, isLoading: false });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const user = await getCurrentUser();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      console.error("Errore validazione token utente:", err);
      localStorage.removeItem("auth_token");
      set({ token: null, user: null, isAuthenticated: false, isLoading: false });
    }
  },

  logout: async () => {
    try {
      await logoutSession();
    } catch {
      // Prosegue con la pulizia locale anche se la richiesta fallisce
    } finally {
      localStorage.removeItem("auth_token");
      set({ token: null, user: null, isAuthenticated: false });
      window.location.href = "/";
    }
  },
}));