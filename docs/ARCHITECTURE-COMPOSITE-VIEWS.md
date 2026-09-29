# Composite Views

La UI usa il Gateway come BFF per le letture aggregate. Il browser non chiama più domini diversi per costruire una singola schermata.

## Contract

```text
GET /api/v1/views/dashboard-today?familyId=...
GET /api/v1/views/pantry-screen?familyId=...
GET /api/v1/views/shopping-screen?familyId=...
GET /api/v1/views/recipes-screen?familyId=...
GET /api/v1/views/nutrition-screen?familyId=...
GET /api/v1/views/family-screen?familyId=...
GET /api/v1/views/notifications-screen?familyId=...
```

Il Gateway esegue il fan-out in parallelo verso i servizi proprietari e restituisce un view model versionato. Le Composite Views sono read-only: tutte le mutation restano sulle API del dominio.

## Caching

TanStack Query usa chiavi che includono `familyId` e nome della view. La navigazione può usare dati cached mentre parte una revalidation in background.

## Failure policy

Una view deve distinguere dipendenze obbligatorie da sezioni opzionali. Un errore di una sezione opzionale può produrre una risposta `degraded`; un errore che rende la schermata non affidabile deve restituire un errore esplicito.
