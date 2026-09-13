# Web application

React + Vite single-page app for family pantry workflows (Oggi, Dispensa, Spesa, Ricette,
Nutrienti, Famiglia, Notifiche). It consumes the versioned `/api/v1` contract in
`docs/openapi.yaml` and never accesses PostgreSQL directly.

> Note: this replaces the earlier "Next.js PWA shell" placeholder mentioned in older docs. The UI
> is a Vite/React SPA; the framework-agnostic domain models below are unchanged.

## Structure

- `src/domain/` — framework-agnostic state models (`shell`, `family-journey`,
  `family-onboarding`, `inventory-journey`, `inventory-workflow`, `shopping-journey`,
  `shopping-workflow`, `runtime`). These keep loading/retrying/offline/conflict states explicit
  and are covered by `npm test`. They predate the UI and are consumed by the API-sync hooks below.
- `src/api/` — typed HTTP client for the backend: `config.ts` (base URL), `client.ts` (fetch
  wrapper, envelope parsing, `ApiError` / `NetworkUnavailableError`), `endpoints.ts` (one function
  per `docs/openapi.yaml` operation used by the UI), `mappers.ts` (DTO ↔ UI type conversion).
- `src/hooks/` — `useInventory`, `useShoppingList`, `useNotifications`, `useFamily`. Each hook:
  1. tries the real endpoint on mount;
  2. if it fails for any reason (backend not running, 404 because the route isn't wired yet per
     `docs/IMPLEMENTATION-STATUS.md`, 401, etc.) falls back to the bundled demo dataset
     (`mockData.ts`) so the UI stays fully interactive as a live demo;
  3. keeps the page components' original `setState`-style API (`setStock`, `setList`, ...) by
     diffing the previous/next state to infer which mutation happened, then firing the matching
     endpoint in the background.
- `src/pages/`, `src/components/` — the UI, based on the provided Figma export. Left as close to
  the original as possible; the only page with a functional change is `Famiglia.tsx`, which gained
  an `onInviteCreated` callback to sync a locally-created invite to the backend.

## Backend connection status (as of this writing)

Only `family` and `inventory` have HTTP controllers ready in `apps/api/src/http.ts`'s dependency
tree; `catalog` and `shopping` have services but no controller yet, and **no domain routes are
wired into the HTTP server at all** — only `/health/live`, `/health/ready`, and `/api/v1/meta`
respond today. Until that's wired up (and Postgres/Redis/Keycloak are running via
`docker compose --profile family-local`, see repo root `README.md`), the app will always show the
demo-mode banner and use the bundled sample data. The API client is written against the documented
contract so it should work with minimal changes once the routes exist — see `src/api/` above for
where to adjust field mappings if the real response shapes differ from what's documented.

## Getting started

```bash
npm install        # from the repo root (workspaces) or from apps/web
cp .env.example .env.local   # optional: point at a different backend
npm run dev         # http://localhost:5173
```

## Scripts

- `npm run dev` — Vite dev server.
- `npm run build` — builds the domain module (`tsc`), type-checks the app, then builds the Vite
  bundle into `dist/`.
- `npm run typecheck` — type-checks both the app (`tsconfig.app.json`) and the domain module
  (`tsconfig.json`).
- `npm test` — compiles and runs the domain module's `node:test` suite (unchanged from before).
