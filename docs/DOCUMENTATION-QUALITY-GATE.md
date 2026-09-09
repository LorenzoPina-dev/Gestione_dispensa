# Quality gate della documentazione

## 1. Ogni specifica deve contenere

- scopo e non-scopo;
- owner e bounded context;
- termini del glossario;
- precondizioni e autorizzazioni;
- input/output e schema;
- stati e transizioni;
- errori e recovery;
- idempotenza/concorrenza;
- dati posseduti e retention;
- logging, metriche e trace;
- test e acceptance criteria;
- compatibilita e versioning;
- dipendenze e degrado;
- rischi e decisioni aperte.

## 2. Regole di coerenza

- `familyId` nei nuovi contratti; `householdId` solo alias/migrazione;
- stessi enum tra requisiti, API, eventi, UI e DB;
- ogni endpoint presente nel catalogo deve avere OpenAPI o issue di materializzazione;
- ogni evento del catalogo deve avere schema e producer/consumer;
- ogni requisito deve avere prova in TRACEABILITY;
- nessun documento puo promettere HA/zero loss/exactly-once senza evidenza;
- link relativi validi;
- date, timezone, unita e precisione numerica esplicite;
- PII e secret classificati.

## 3. Review obbligatorie

- product review: valore e priorita;
- architecture review: confini, dati, scaling;
- security review: threat model e authz;
- privacy review: finalita, retention, DPIA;
- operations review: SLO, backup, runbook;
- UX/accessibility review: journey e stati;
- QA review: testability e acceptance.

## 4. Stato documento

Ogni documento deve dichiarare `DRAFT`, `REVIEW`, `APPROVED` o `SUPERSEDED`, owner, versione e data. Una specifica non approvata puo guidare il design ma non autorizza una release.
