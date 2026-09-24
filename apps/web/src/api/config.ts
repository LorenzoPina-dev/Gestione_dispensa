/**
 * Backend connection settings. In sviluppo i default sono path relativi: la pagina è servita da
 * Vite in HTTPS, API e Keycloak girano in HTTP locale — il browser rifiuta richieste cross-origin
 * HTTP da una pagina HTTPS (mixed content). Il proxy configurato in vite.config.ts inoltra
 * `/api` e `/realms` verso `http://localhost:3000` e `http://localhost:8080`, così dal punto di
 * vista del browser è tutto same-origin HTTPS.
 *
 * In produzione, override a build time con un `.env.local`:
 *
 *   VITE_API_BASE_URL=https://api.example.com/api/v1
 *   VITE_OIDC_ISSUER=https://auth.example.com/realms/dispensa
 */
// apps/web/src/api/config.ts
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ||
  "/api/v1";

export const KEYCLOAK_REALM_URL: string =
  (import.meta.env.VITE_OIDC_ISSUER as string | undefined)?.replace(/\/+$/, "") ||
  "/realms/dispensa";

export const KEYCLOAK_CLIENT_ID: string =
  (import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined) || "dispensa-app";

/**
 * Fallback family id usato dagli hook quando non c'è ancora un utente loggato. Normalmente
 * `App.tsx` passa `currentUser.hasFamilyId`, quindi questa env var serve solo per testare il
 * layer API prima che il flusso di login sia cablato.
 */
export const FAMILY_ID: string | undefined = import.meta.env.VITE_FAMILY_ID;

/**
 * Token bearer per test locali senza passare da Keycloak. Da mettere in `.env.local`, mai
 * committare. In produzione l'API verifica i token OIDC reali (vedi
 * apps/api/src/identity/oidc.ts).
 */
export const DEV_BEARER_TOKEN: string | undefined = import.meta.env.VITE_DEV_BEARER_TOKEN;

/** Request timeout prima che una chiamata sia considerata irraggiungibile. */
export const API_TIMEOUT_MS = 6000;

/**
 * A stable per-browser identifier used only as the `browserBindingHash` the invite-resolve
 * endpoints require (binds a join attempt to the browser that started it, per
 * apps/api/src/family/invites.ts). Generated once and cached in localStorage; holds no personal
 * data, just a random id, so it's safe to keep indefinitely.
 */
export function getBrowserBindingHash(): string {
  const KEY = "dispensa.browser-binding";
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing && /^[0-9a-f]{32,64}$/i.test(existing)) return existing;
    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "")
        : Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    window.localStorage.setItem(KEY, generated);
    return generated;
  } catch {
    // No storage available — fall back to a per-call random value (still format-valid).
    return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  }
}