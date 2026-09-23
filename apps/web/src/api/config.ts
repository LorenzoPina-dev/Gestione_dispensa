/**
 * Backend connection settings. Override at build/dev time with a `.env.local` file:
 *
 *   VITE_API_BASE_URL=http://localhost:3000/api/v1
 *
 * Defaults to the local `docker-compose --profile family-local` port documented in
 * `.env.example` (API_PORT=3000) and the `/api/v1` base path.
 */
// apps/web/src/api/config.ts
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ||
  "http://localhost:3000/api/v1";

export const KEYCLOAK_REALM_URL =
  import.meta.env.VITE_OIDC_ISSUER || "http://localhost:8080/realms/dispensa";

export const KEYCLOAK_CLIENT_ID =
  import.meta.env.VITE_OIDC_CLIENT_ID || "dispensa-app";


/**
 * Fallback family id used by the hooks when there is no signed-in user yet (e.g. before Login
 * runs). Once a user logs in or completes Onboarding, `App.tsx` passes `currentUser.hasFamilyId`
 * to the hooks instead — see `hooks/useInventory.ts`, `hooks/useShoppingList.ts`,
 * `hooks/useFamily.ts`. Onboarding's "create a family" step calls the real
 * `POST /api/v1/families` and uses the returned id, so in normal use this env var is only useful
 * for testing the API layer before wiring up a screen.
 */
export const FAMILY_ID: string | undefined = import.meta.env.VITE_FAMILY_ID;

/**
 * The backend's OIDC verifier requires a real bearer token on every request (see
 * apps/api/src/identity/oidc.ts). Login/Register in this UI are local mock screens (the backend
 * has no password-auth endpoint at all), so for local testing against a real backend you can
 * mint a token against your Keycloak instance and set it here. Never commit a real token — this
 * is a `.env.local`-only development convenience, not a production auth mechanism.
 */
export const DEV_BEARER_TOKEN: string | undefined = import.meta.env.VITE_DEV_BEARER_TOKEN;

/** Request timeout before a call is treated as unreachable and demo mode kicks in. */
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
