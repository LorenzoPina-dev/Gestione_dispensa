# Requirements

## Architettura
- Microservizi indipendenti.
- **Database dedicato per ogni microservizio.**
- Nessun accesso cross-database.
- Contratti HTTP/eventi versionati.
- Outbox per eventi da mutazioni.
- Consumer idempotenti + retry + DLQ.
- Nginx come unico ingresso browser.
- OIDC + autorizzazione per famiglia.
- MinIO per blob, Redis per infrastruttura transient.
- Deploy/scaling indipendente.

## Funzionalità
Famiglie/inviti, dispensa e movimenti, barcode, catalogo/OpenFoodFacts, scansione immagini, OCR scontrini, stima scadenze, notifiche, spesa, prezzi/offerte, ricette, nutrizione, privacy/export/erasure e job asincroni.

I dati authoritative appartengono al service owner; cache e projection sono ricostruibili.
