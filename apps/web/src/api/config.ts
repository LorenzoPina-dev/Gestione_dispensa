/**
 * Backend connection settings. Override at build/dev time with a `.env.local` file:
 *
 *   VITE_API_BASE_URL=http://localhost:3000/api/v1
 *
 * Defaults to the local `docker-compose --profile family-local` port documented in
 * `.env.example` (API_PORT=3000) and the `/api/v1` base path.
 */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ||
  "http://localhost:3000/api/v1";

/**
 * The real backend requires an explicit `familyId` on almost every call (create stock item,
 * list inventory, get active shopping list, ...) but there is no "list my families" or sign-in
 * flow anywhere in this UI (or in the backend's HTTP surface — see apps/api/src/http.ts) to
 * discover it. Until a real auth/onboarding flow exists, set VITE_FAMILY_ID to a family id you
 * created via `POST /api/v1/families` so the app can talk to it. Without it, every family-scoped
 * call fails validation server-side and the app falls back to demo data.
 */
export const FAMILY_ID: string | undefined = import.meta.env.VITE_FAMILY_ID;

/**
 * The backend's OIDC verifier requires a real bearer token on every request (see
 * apps/api/src/identity/oidc.ts). There is no login screen in this UI, so for local testing you
 * can mint a token against your Keycloak instance and set it here. Never commit a real token —
 * this is a `.env.local`-only development convenience, not a production auth mechanism.
 */
export const DEV_BEARER_TOKEN: string | undefined = import.meta.env.VITE_DEV_BEARER_TOKEN;

/** Request timeout before a call is treated as unreachable and demo mode kicks in. */
export const API_TIMEOUT_MS = 6000;
