# Current gap analysis

| Area | Stato | Gap principale |
|---|---|---|
| Identity | Partial | verifica E2E completa |
| Family | Good | RLS e test isolamento |
| Inventory | Good | RLS, audit/restore uniformi |
| Shopping | Partial | offline merge |
| Catalog/OFF | Partial | enrichment E2E |
| Recipes | Partial | cooking + conversion |
| Nutrition | Partial | calculation pipeline |
| Stores | Partial | normalized comparison |
| Shelf-Life | Partial | worker refinement evidence |
| OCR | Partial | staging/atomic confirmation |
| Notifications | Partial | real push providers |
| Web | Good | E2E all journeys |
| Gateway/BFF | Good | contract/error/degraded tests |
| WebSocket | Missing | family-scoped gateway |
| RLS | Missing/Unverified | DB policies + tests |
| Audit/Restore | Partial | uniform implementation |

Questo documento è sincronizzato con `CURRENT-IMPLEMENTATION-STATUS.md` e `IMPLEMENTATION-BACKLOG.md`.
