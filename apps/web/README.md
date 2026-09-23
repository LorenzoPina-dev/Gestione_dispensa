# Web application

React + Vite single-page app for family pantry workflows (Oggi, Dispensa, Spesa, Ricette,
Nutrienti, Famiglia, Notifiche), plus Login/Register/Onboarding screens. It talks to the real
`/api/v1` HTTP surface already wired in `apps/api/src/http.ts` where that surface exists, and
falls back to a bundled demo dataset everywhere it doesn't.

> Note: this replaces the earlier "Next.js PWA shell" placeholder mentioned in older docs. The UI
> is a Vite/React SPA; the framework-agnostic domain models below are unchanged.

## Structure

- `src/domain/` — framework-agnostic state models (`shell`, `dashboard`, `family-journey`,
  `family-onboarding`, `inventory-journey`, `inventory-workflow`, `shopping-journey`,
  `shopping-workflow`, `runtime`). These predate the UI, keep loading/retrying/offline/conflict
  states explicit, and are covered by `npm test`. `useInventory`/`useShoppingList` use the
  inventory/shopping journey modules to classify sync outcomes (success/conflict/offline/retry).
- `src/api/` — typed HTTP client for the **real, already-implemented** backend routes (not
  `docs/openapi.yaml`, whose documented paths/shapes don't match what's actually wired — see the
  comment at the top of `api/types.ts`): `config.ts` (base URL + dev-only auth), `client.ts`
  (fetch wrapper, envelope parsing, `ApiError` / `NetworkUnavailableError`), `endpoints.ts` (one
  function per real endpoint), `mappers.ts` (DTO ↔ UI type conversion).
- `src/hooks/` — `useInventory(familyId)`, `useShoppingList(familyId)`, `useFamilyInviteSync
  (familyId)`. Each data hook: tries the real endpoint; if it fails for any reason (no
  `familyId` yet, backend not running, error) falls back to the bundled demo dataset
  (`mockData.ts`) so the UI stays fully interactive as a live demo; keeps the page components'
  original `setState`-style API (`setStock`, `setList`, ...) by diffing the previous/next state
  to infer which mutation happened, then firing the matching endpoint in the background.
- `src/pages/`, `src/pages/auth/`, `src/pages/onboarding/`, `src/components/`,
  `src/components/ui/` — the UI. `src/tokens.ts` is the single source of truth for colors/fonts;
  `src/utils/` holds small pure helpers (`expiry.ts`, `roles.ts`, `time.ts`).
- `src/store/auth.ts` — `AuthUser`/`AuthScreen` types for the local login/onboarding state
  machine in `App.tsx`.

## What's really connected to the backend, and what isn't

The real backend (`apps/api/src/http.ts`) now exposes: `POST /families`, `GET /families`, `GET`
`/families/{id}/members`, `PATCH`/`DELETE /families/{id}/members/{membershipId}`, `POST
/families/{id}/invites`, `POST /invites/resolve`, `POST /invites/{id}/accept`, `POST
/catalog/products`, `GET /catalog/lookup`, `GET`/`POST /inventory/stock-items`, `POST
.../movements`, `GET /shopping/lists/active`, `POST /shopping/lists`, `POST
/shopping/lists/{id}/items`, `PATCH /shopping/lists/{id}/items/{itemId}`, `POST
/shopping/lists/{id}/batch-action`. Given that surface:

- **Login/Register/Forgot password** — local mock only. The backend has no password-auth
  endpoint (it verifies OIDC bearer tokens, see `apps/api/src/identity/oidc.ts`); building a real
  redirect-based OIDC flow was out of scope here. The signed-in user is kept in `localStorage`
  (`App.tsx`, `SESSION_STORAGE_KEY`) purely so a page refresh doesn't log you out — this is a
  client convenience, not a real session/auth mechanism.
- **Onboarding → "Crea una nuova famiglia"** — **really wired**: calls `POST /api/v1/families`
  and uses the real returned id as the session's `familyId` for everything else. Falls back to a
  local demo id if the backend is unreachable.
- **Onboarding → "Unisciti con un invito"** — local mock only. The backend can only resolve an
  invite by its secret QR token (`invites/resolve`), not by the human-readable fallback code this
  screen collects, and there's no such lookup endpoint yet.
- **Dispensa (inventory)** — really wired: list, create (via catalog product + stock item), and
  consume/waste (as inventory movements with `If-Match` version checking) all call the real
  endpoints when a real `familyId` is active.
- **Spesa (shopping)** — really wired: loading the active list (auto-creating one on first use),
  adding items, accepting/snoozing/ignoring/completing a single item, and batch-accepting several
  selected items all call the real endpoints, each with `If-Match` optimistic concurrency.
- **Famiglia (members)** — really wired: listing members, creating an invite, changing a
  member's role, and removing a member all call the real endpoints. Caveat: `family_memberships`
  rows have no user-profile join in this backend, so real members show as "Utente xxxxxxxx"
  rather than a real name/email/avatar — see the comment in `hooks/useFamily.ts`. Also, because
  login is mock, the signed-in `AuthUser.id` generally won't match any real membership id, so the
  "tu" (you) badge won't highlight your own row when connected to a real backend.
- **Notifiche, Nutrienti, Ricette** — no backend domain exists for these at all; always demo
  data. Ricette's "match" scoring runs entirely client-side against the demo recipe list.

## Deliberately out of scope

- **Real OIDC login** — would need a redirect/PKCE flow against Keycloak plus a callback route;
  the current Login/Register screens are UI-only mocks by design (see the note above).
- **Notifications, nutrition tracking, and recipes as backend domains** — these are new product
  features, not gaps in an existing domain; adding them means new schema/service/controller/HTTP
  layers, not just wiring.
- **Offline retry queue and conflict-resolution UI** — failed syncs are logged to the console
  (see `logSyncFailure` in the hooks) but not queued for retry or surfaced to the user beyond the
  existing optimistic UI update.

## Getting started

```bash
npm install        # from the repo root (workspaces) or from apps/web
cp .env.example .env.local   # optional: point at a different backend / set a dev token
npm run dev         # http://localhost:5173
```

Log in with one of the demo accounts shown on the login screen, or register a new account and
create a family in Onboarding — if the backend (`docker compose --profile family-local up`, see
repo root `README.md`) is reachable, that family creation call is real and the app will use it
for inventory/shopping; otherwise everything gracefully runs in demo mode with a banner saying so.

## Scripts

- `npm run dev` — Vite dev server.
- `npm run build` — builds the domain module (`tsc`), type-checks the app, then builds the Vite
  bundle into `dist/`.
- `npm run typecheck` — type-checks both the app (`tsconfig.app.json`) and the domain module
  (`tsconfig.json`).
- `npm test` — compiles and runs the domain module's `node:test` suite (unchanged from before).
