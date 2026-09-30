import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SESSION_EXPIRED_EVENT, TOKENS_REFRESHED_EVENT } from "../api/client";

export type AuthScreen = "login" | "register" | "forgot" | "onboarding" | "app";

export type Role = "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: Role;
  hasFamilyId: string | null;
}

interface AuthState {
  /** Access token OIDC corrente (JWT). Usato da client.ts per l'header Authorization. */
  token: string | null;
  /** Refresh token OIDC. Presente solo se lo scope `offline_access` è stato richiesto. */
  refreshToken: string | null;
  /** Epoch ms in cui `token` scade. Usato da client.ts per rinnovare in anticipo. */
  expiresAt: number | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  error: string | null;

  /** Compatibilità: alcuni consumer passano solo l'access token (nessun refresh). */
  setToken: (token: string | null) => void;
  /** Login/Register dopo il password grant: salva il bundle completo (access + refresh). */
  setTokens: (bundle: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }) => void;
  clearToken: () => void;
  setUser: (user: AuthUser | null) => void;
  setError: (error: string | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      expiresAt: null,
      user: null,
      isAuthenticated: false,
      error: null,

      setToken: (token) =>
        set({
          token,
          // Azzera il refresh: se qualcuno chiama setToken direttamente (bypassando il
          // password grant), non abbiamo un refresh token valido da usare. Il prossimo 401
          // porterà al login, come deve.
          refreshToken: null,
          expiresAt: null,
          isAuthenticated: token !== null,
        }),

      setTokens: ({ accessToken, refreshToken, expiresIn }) =>
        set({
          token: accessToken,
          refreshToken,
          expiresAt: Date.now() + expiresIn * 1000,
          isAuthenticated: true,
        }),

      clearToken: () =>
        set({
          token: null,
          refreshToken: null,
          expiresAt: null,
          user: null,
          isAuthenticated: false,
        }),

      setUser: (user) => set({ user }),
      setError: (error) => set({ error }),
    }),
    { name: "dispensa-auth" },
  ),
);

// ── Bridge tra client.ts e store ───────────────────────────────────────────────
//
// Il refresh avviene fuori da React (in client.ts) e non può importare lo store (ciclo di
// import ESM). Questi due listener allineano lo stato in memoria a quello che client.ts ha
// appena scritto in localStorage, così `useAuthStore((s) => s.token)` resta fresco.
if (typeof window !== "undefined") {
  window.addEventListener(SESSION_EXPIRED_EVENT, () => {
    useAuthStore.getState().clearToken();
    useAuthStore.getState().setError("Sessione scaduta. Effettua di nuovo l'accesso.");
  });

  window.addEventListener(TOKENS_REFRESHED_EVENT, (e) => {
    const d = (e as CustomEvent).detail as {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    };
    useAuthStore.setState({
      token: d.accessToken,
      refreshToken: d.refreshToken,
      expiresAt: d.expiresAt,
      isAuthenticated: true,
    });
  });
}