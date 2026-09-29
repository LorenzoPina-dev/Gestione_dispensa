# Current implementation status

Questo documento descrive lo stato della codebase attuale. Non è un piano storico di migrazione.

## Implementato nella struttura runtime

- monorepo organizzato per servizi sotto `services/`;
- UI React/Vite come deployable `services/web`;
- Nginx come unico ingresso browser;
- Gateway autenticato con routing e Composite Views;
- servizi Identity, Family, Inventory, Shopping, Catalog, Notifications, Privacy e Jobs;
- servizi Recipes, Nutrition, Stores, Shelf-Life e OCR;
- OpenFoodFacts cache dedicata;
- worker e scheduler separati;
- PostgreSQL con schema ownership esplicita;
- Redis per delivery asincrono;
- MinIO per blob;
- contratti condivisi in `packages/contracts`.

## Capability coverage

| Capability | Stato documentale | Nota |
|---|---|---|
| Identity/profile | Implementato parzialmente | OIDC/JWT e profilo presenti; il flusso completo va verificato end-to-end |
| Family/membership/invites | Implementato | route e persistence presenti |
| Inventory/lots/movements | Implementato | optimistic concurrency e depletion presenti |
| Shopping | Implementato parzialmente | idempotency presente; offline merge completo da verificare |
| Catalog/OFF | Implementato parzialmente | cache e lookup presenti; enrichment completo da verificare |
| Recipes | Implementato parzialmente | API presenti; cooking/conversione richiedono completamento |
| Nutrition | Implementato parzialmente | superficie HTTP presente; calcolo completo da completare |
| Stores/prices | Implementato parzialmente | CRUD storico presente; normalized comparison da completare |
| Shelf-Life | Implementato parzialmente | prediction sync + worker boundary presenti |
| OCR | Implementato parzialmente | job/review boundary presente; pipeline reale da completare |
| Notifications | Implementato parzialmente | in-app boundary presente; push provider reale da verificare |
| WebSocket | Non completo | manca un Gateway WebSocket applicativo definitivo |
| Offline merge | Non completo | idempotency presente, conflict/merge da completare |
| Audit before/after | Non completo | audit operativo presente in alcune aree, trail uniforme da completare |
| Restore | Non completo | recovery uniforme per tutti i domini da completare |
| PostgreSQL RLS | Da verificare/implementare | il requisito deve essere provato con policy DB reali |
| BFF Composite Views | Implementato | sette view aggregate presenti |

## Regola di verità

La presenza di una route non implica che l'intera capability sia completa. Una capability è `completa` solo quando codice, persistence, authorization, async path, test e UI journey richiesti dal contratto sono presenti e verificati.

## Verification gates

Prima di dichiarare un servizio pronto:

1. `npm run typecheck`;
2. `npm run build`;
3. unit/integration tests;
4. contract tests Gateway ↔ service;
5. PostgreSQL migration + seed;
6. authorization/family isolation tests;
7. retry/idempotency/concurrency tests;
8. health/readiness;
9. E2E attraverso Nginx.
