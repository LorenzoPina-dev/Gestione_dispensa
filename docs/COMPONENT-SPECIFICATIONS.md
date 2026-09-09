# Specifiche tecniche dei componenti

Questo documento e il contratto di handoff per chi implementa. Ogni componente ha responsabilita singola, input/output, dipendenze, errori, dati posseduti e segnali osservabili.

## 1. Regole comuni

Ogni servizio deve:

- validare configurazione e schema all'avvio;
- avere live, startup e readiness probe;
- propagare `traceparent`, `traceId`, `requestId`, `actorId` e `householdId` autorizzato;
- non loggare token, immagini, payload alimentari o dati personali non necessari;
- applicare timeout, cancellation, retry solo su errori transient e idempotenza;
- esporre versione, build e schema contract;
- chiudersi con graceful shutdown senza perdere messaggi gia persistiti;
- possedere metriche di durata, errori, throughput, backlog e saturazione;
- usare UTC e UUID; usare `numeric` per quantita e denaro.

## 2. Gateway

**Scopo**: unico ingresso esterno e punto di policy trasversale.

**Input**: HTTPS, cookie sessione o token OIDC, request id opzionale, body entro quota.

**Output**: risposta API, `202 + jobId` per lavori asincroni, error envelope con `traceId`.

**Responsabilita**:

- TLS, security headers, CORS e request size;
- autenticazione e contesto tenant/household;
- rate limit per identita, route e capability;
- routing a API o status/job endpoint;
- propagazione trace e redazione errori;
- circuit breaking del traffico verso dipendenze.

**Non fa**: accesso diretto alle tabelle, orchestrazione con privilegi runtime, logica inventario, attivazione di container per ogni request.

**Errori**: `401`, `403`, `404`, `408`, `413`, `429`, `503`; non rivela esistenza di risorse non autorizzate.

**Metriche**: request count, status, p50/p95/p99, bytes, rate-limit, auth failure, upstream latency/error.

## 3. API service

**Scopo**: application layer sincrono e transazioni core.

**Input**: comandi REST versionati, query validate, `Idempotency-Key`, `If-Match` quando serve.

**Output**: DTO versionati, cursor pagination, `ETag`, error envelope o `jobId`.

**Responsabilita**: policy, use case, transazione, outbox, accesso ai repository proprietari, autorizzazione applicativa.

**Dipendenze**: PostgreSQL, Redis solo per cache/lock/coda, OIDC introspection/JWKS, capability registry read-only.

**Non fa**: chiamate lunghe a provider, OCR, generazione AI, import bulk sincroni.

**Errori**: schema invalid, conflict, idempotency conflict, not found autorizzato, dependency unavailable.

**Metriche**: request per use case, DB duration, outbox writes, conflict rate, cache hit, async submission.

## 4. Identity and access service

**Scopo**: integrare OIDC e applicare membership, ruolo e policy ABAC.

**Input**: identity provider claims, inviti, richieste di membership e ruoli.

**Output**: principal normalizzato, decisione allow/deny, sessione revocabile, audit event.

**Dati posseduti**: user mapping, external identities, session metadata, policy version. Famiglie, membership e inviti QR appartengono al Family service.

**Regole**: ruoli minimi `OWNER`, `MANAGER`, `MEMBER`, `VIEWER`; deny-by-default; service account con scope specifici; ogni cambio ruolo e auditato.

**Errori**: token invalid, membership revoked, invitation expired, policy unavailable.

**Metriche**: login, deny rate, token validation, invitation completion, policy latency.

## 5. Family service

**Scopo**: gestire famiglie, membership, ruoli, inviti QR e famiglia attiva.

**Input**: create family, create/revoke/resolve/accept invite, role change, remove member, switch active family.

**Output**: family preview limitata, membership, join attempt, redirect allowlisted, eventi family e audit.

**Dati posseduti**: `families`, `family_memberships`, `family_invites`, `family_join_attempts`.

**Regole**: token QR opaco, hash-only a database, scadenza, uso singolo, revoca, rate limit fallback, review prima dell'accesso, transazione atomica per accept, vincolo unico membership, nessun leak cross-family.

**Dipendenze**: Identity/access, PostgreSQL, outbox, audit, gateway.

**Errori**: invite unavailable generico, membership conflict, role forbidden, family limit reached, join attempt expired.

**Metriche**: invite outcome, join duration, auth redirect, accept conflict, invalid attempts, membership operation duration.

## 6. Catalog service

**Scopo**: prodotto canonico e dati identificativi/nutrizionali provenienti da fonti.

**Input**: create/update manuale, barcode, candidate esterno, correzione operator.

**Output**: `Product`, `ProductIdentifier`, `DataProvenance`, evento `catalog.product-updated.v1`.

**Regole**: identificatori unici per tipo/valore; dato manuale confermato prevale su import automatico; merge reversibile e auditato; nutrition/allergens hanno confidence e fonte.

**Dipendenze**: PostgreSQL, integration queue, eventuale search index.

**Metriche**: lookup hit, match confidence, conflict, stale source, merge/reject.

## 7. Inventory service

**Scopo**: stato autorevole delle scorte e ledger dei movimenti.

**Input**: ricezione, consumo, spreco, rettifica, trasferimento, soglia.

**Output**: saldo/proiezione, `stock_movement`, eventi inventory, suggerimento reorder.

**Regole**: ledger append-only; una rettifica e un nuovo movimento; transazione e lock sullo stock; idempotenza per comando; quantità negative solo con policy esplicita; household obbligatorio.

**Dipendenze**: PostgreSQL, outbox, core worker.

**Metriche**: movement latency, duplicate commands, negative rejection, stock count, reorder events.

## 8. Shopping service

**Scopo**: liste e righe, incluse proposte automatiche.

**Input**: add/update/complete/snooze/ignore, reorder event, offer suggestion.

**Output**: lista versionata, `shopping.item.suggested.v1`, stato riga.

**Regole**: unique key prodotto/unita/lista; completamento non altera retroattivamente il ledger; suggerimenti automatici sono distinguibili da decisioni utente; concorrenza con ETag.

**Metriche**: suggested-to-accepted, duplicate merge, completion latency, active lists.

## 9. Recognition service

**Scopo**: barcode/OCR/vision come pipeline di candidati, non fonte automatica definitiva.

**Input**: barcode o `mediaAssetId`, tipo documento, locale, household e policy consenso.

**Output**: `recognitionJob`, candidati con campo, valore, confidence, evidence, fonte e stato review.

**Pipeline**: validate asset -> antivirus -> OCR/vision adapter -> normalizzazione -> catalog match -> review -> publish confirmed command.

**Errori**: unsupported media, malware, provider timeout, low confidence, ambiguous match.

**Metriche**: processing duration, confidence distribution, provider error, review rate, false correction.

## 10. Recipe service

**Scopo**: recuperare, normalizzare e classificare ricette.

**Input**: ingredienti disponibili, scadenze, preferenze, allergeni esclusi, tempo, calorie target opzionale.

**Output**: suggerimenti con score scomposto, ingredienti presenti/mancanti, sostituzioni, fonte e disclaimer.

**Regole**: allergeni esclusi sono hard constraint; AI output non verificato e marcato; il ranking deve essere spiegabile; non inferire condizioni mediche.

**Dipendenze**: catalog, inventory read model, recipe source, nutrition.

**Metriche**: generation/ranking duration, acceptance, missing ingredient rate, allergen filter violations (target zero).

## 11. Nutrition service

**Scopo**: normalizzare nutrienti, calcolare porzioni e aggregare consumi.

**Input**: profilo prodotto con fonte, serving size, consumo confermato o stimato.

**Output**: calorie/macro/micro con origine, formula, qualita e distinzione measured/estimated.

**Regole**: nessun valore senza fonte o label unknown; arrotondamenti documentati; risultati informativi, non medici; cancellazione/export rispettano privacy.

**Metriche**: source coverage, unknown rate, calculation failures, estimate/corrected ratio.

## 12. Offers service

**Scopo**: importare e normalizzare offerte legittimamente disponibili.

**Input**: feed/API adapter, area, retailer, periodo, barcode/SKU, condizioni.

**Output**: offer con fonte, validita, localizzazione, confidence; evento `offer.imported.v1`.

**Regole**: termini e rate limit per fonte; deduplica; offerta scaduta esclusa; matching incerto non viene mostrato come esatto.

**Metriche**: import duration, records, match rate, stale rate, source error/429.

## 13. Worker core

**Scopo**: consumare eventi di inventario e produrre soglie/lista/notifiche core.

**Input**: eventi versionati da code separate.

**Output**: eventi idempotenti, aggiornamenti applicativi e job status.

**Regole**: risorse riservate; ack dopo commit; retry classificato; DLQ; reconciliation periodica da PostgreSQL.

**Metriche**: queue depth, oldest age, throughput, retry, DLQ, handler duration.

## 14. Search indexer

**Scopo**: proiezione read-only per ricerca rapida.

**Input**: catalog/inventory/shopping events.

**Output**: documenti indicizzati con `projectionVersion` e timestamp.

**Regole**: nessun dato autorevole; replay completo da eventi/snapshot; mapping versionato; stato stale visibile internamente.

**Metriche**: lag, indexing throughput, rejected documents, rebuild duration.

## 15. Notification service

**Scopo**: inviare email/push/in-app secondo consenso e preferenze.

**Input**: notification event, template version, recipient policy.

**Output**: delivery status, provider message id, retry/DLQ.

**Regole**: opt-in dove richiesto; idempotency per notification; non inviare dati eccessivi; unsubscribe; provider isolato da core.

## 16. Observability platform

**Scopo**: raccogliere, conservare e correlare metriche, log e trace.

**Input**: OTLP da servizi, exporter host/Kubernetes, audit stream separato.

**Output**: Prometheus metrics, Loki logs, Tempo traces, Grafana dashboards, Alertmanager notifications.

**Regole**: retention per profilo, redazione, cardinalita controllata, alert come codice, nessuna dipendenza del dominio dalla UI.

## 17. Platform controller

**Scopo**: applicare policy operativa di attivazione capability, senza diventare parte del dominio.

**Input**: config dichiarativa, backlog, risorse host, health, schedule.

**Output**: desired state di Compose profile o Deployment/scale policy, audit tecnico.

**Regole**: least privilege; no shell arbitraria da API; allowlist di capability; hysteresis per evitare start/stop oscillante; manual override auditato; core mai autospegnibile.

## 18. Dipendenze e ownership

| Componente | Fonte autorevole | Dipendenze critiche | Degrado |
|---|---|---|---|
| API | PostgreSQL | DB, identity | core read-only o unavailable |
| Inventory | PostgreSQL ledger | DB, outbox | nessun movimento perso |
| Worker core | eventi + PostgreSQL | DB, queue | backlog/replay |
| Recognition | job status DB + asset store | object storage, provider | pending |
| Search | projection | eventi/search engine | query DB fallback |
| Offers | offer records | provider | dati stale marcati |
| Recipes | recipe source/cache | catalog, inventory | nessun suggerimento |
| Observability | metric/log/trace stores | collector/backends | dominio continua |
