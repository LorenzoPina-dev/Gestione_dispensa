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
- **R-C01:** ogni endpoint ha input schema, output schema, status code ed error contract.
- **R-C02:** OpenAPI è allineato a API.md e viene validato in CI.
- **R-C03:** ogni mutation definisce idempotency policy e, quando necessario, optimistic concurrency.
- **R-C04:** ogni evento ha envelope e payload versionati.
- **R-C05:** ogni service ha contract tests HTTP/eventi e migration tests sul proprio DB.
- **R-C06:** request con schema strict non accetta campi non documentati.
- **R-C07:** ogni dato ha un solo service owner authoritative.
- **R-C08:** nessuna feature è implementata senza contract-to-code traceability.

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

## Acceptance criteria

Una feature è accettata solo quando:

1. owner e bounded context sono identificati;
2. DB e schema sono documentati;
3. API/event contract è documentato;
4. OpenAPI/event schemas sono validati;
5. auth e tenant rules sono testate;
6. errori e retry sono testati;
7. idempotency/concurrency sono testate;
8. migration e rollback strategy sono verificati;
9. non esistono accessi cross-DB;
10. failure downstream produce il comportamento documentato.
