# Requirements

## Architettura

- **R-A01:** microservizi indipendenti e deployabili.
- **R-A02:** database dedicato per ogni microservizio.
- **R-A03:** nessun accesso cross-database.
- **R-A04:** ogni DB ha owner, migration e credenziali proprie.
- **R-A05:** contratti HTTP/eventi versionati.
- **R-A06:** Outbox per eventi generati da mutazioni.
- **R-A07:** consumer idempotenti, retry bounded e DLQ.
- **R-A08:** Nginx è l'unico ingresso browser-facing.
- **R-A09:** OIDC + authorization per family/tenant.
- **R-A10:** MinIO per blob; Redis per infrastruttura transient.
- **R-A11:** deploy/scaling/backup indipendente per service.
- **R-A12:** niente transazioni distribuite.

## Funzioni

Il sistema deve supportare:

- registrazione/login e profilo;
- famiglie, membri e inviti;
- dispensa, lotti, consumo e spreco;
- barcode e catalogo;
- OpenFoodFacts cache/read-through;
- scansione immagini;
- OCR scontrini;
- stima scadenze;
- notifiche;
- liste della spesa e low-stock;
- negozi, prezzi e offerte;
- ricette e suggerimenti;
- nutrizione;
- privacy, consenso, export e cancellazione;
- job asincroni e integrazioni.

## Source of truth

Ogni dato authoritative appartiene al service owner. Cache, projection e Composite View sono ricostruibili e non sostituiscono il database owner.
