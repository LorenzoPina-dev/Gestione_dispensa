# API ↔ Web integration

La Web UI è un deployable autonomo (`services/web`) e comunica esclusivamente con Nginx. Tutte le API applicative passano dal Gateway.

## Browser boundary

```text
Browser → Nginx /api/v1/* → Gateway → owning service
Browser → Nginx /        → Web container
Browser → Nginx /realms/ → Keycloak
```

## Screen reads

Le schermate principali usano le Composite Views:

- dashboard → `/api/v1/views/dashboard-today`;
- pantry → `/api/v1/views/pantry-screen`;
- shopping → `/api/v1/views/shopping-screen`;
- recipes → `/api/v1/views/recipes-screen`;
- nutrition → `/api/v1/views/nutrition-screen`;
- family → `/api/v1/views/family-screen`;
- notifications → `/api/v1/views/notifications-screen`.

## Mutations

Le mutation passano al dominio owner attraverso il Gateway e usano, quando applicabile, `If-Match` e `X-Idempotency-Key`.

## Client state

TanStack Query gestisce cache, stale-while-revalidate, invalidazione e prefetch. Le mutation offline-safe vengono serializzate nella queue locale e riconciliate con idempotency + optimistic concurrency.

## UI contract

La UI distingue loading, refreshing, offline, conflict, error e degraded. Nessun componente inventa dati quando un endpoint non è disponibile.
