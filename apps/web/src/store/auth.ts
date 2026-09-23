// apps/web/src/store/auth.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getCurrentUser, logoutSession } from "../api/endpoints";
import { SESSION_EXPIRED_EVENT } from "../api/client";
import type { UserDto } from "../api/types";

/** Tipo usato dalle pagine di auth; allineato al profilo che il backend ritorna da /me. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";
  hasFamilyId: string | null;
}

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

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      setToken: (token: string) => {
        set({ token, isAuthenticated: true });
      },

      initializeAuth: async () => {
        const token = get().token;
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
          set({ token: null, user: null, isAuthenticated: false, isLoading: false });
        }
      },

      logout: async () => {
        try {
          await logoutSession();
        } catch {
          // Prosegue con la pulizia locale anche se la richiesta fallisce
        } finally {
          set({ token: null, user: null, isAuthenticated: false });
          window.location.href = "/";
        }
      },
    }),
    {
      name: "dispensa-auth",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);

/**
 * `apiRequest` (api/client.ts) cancella localStorage e emette questo evento ogni volta che il
 * backend risponde 401 (token scaduto/non valido), qualunque sia la chiamata che l'ha causato.
 * Prima questo listener non esisteva: solo `localStorage` veniva ripulito, mentre lo stato
 * Zustand in memoria restava `isAuthenticated: true` con un token ormai andato — l'app credeva
 * di essere ancora loggata mentre ogni richiesta successiva partiva senza header Authorization,
 * causando una cascata di errori silenziosi invece di un messaggio chiaro all'utente.
 */
if (typeof window !== "undefined") {
  window.addEventListener(SESSION_EXPIRED_EVENT, () => {
    useAuthStore.setState({
      token: null,
      user: null,
      isAuthenticated: false,
      error: "La sessione è scaduta. Accedi di nuovo per continuare.",
    });
  });
}