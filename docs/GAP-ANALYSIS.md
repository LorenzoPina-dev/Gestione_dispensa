# Gap analysis e rischi residui

## 1. Sintesi

La base architetturale copre servizi, asincronia, recovery e osservabilita. La verifica dei percorsi utente e documentata in [User journeys e requisiti di esperienza](USER-JOURNEYS-AND-UX.md) e nei requisiti FR-080..093/NFR-011..016. Prima dell'implementazione restano decisioni e componenti necessari per raggiungere una qualita realmente professionale.

## 2. Gap critici da chiudere prima del primo rilascio

| Gap | Rischio | Azione richiesta | Priorita |
|---|---|---|---|
| threat model formale | attacchi a upload, provider, tenant e runtime | STRIDE per gateway, identity, file, queue, admin | P0 |
| DPIA e registro trattamenti | non conformita su dieta, foto e profilazione | coinvolgere privacy/legal, definire basi e retention | P0 |
| schema registry e ownership | breaking event/API e replay non sicuro | versionare OpenAPI/JSON Schema e contract test | P0 |
| backup esterno verificato | perdita dati sul vecchio PC | backup cifrato + restore drill + checksum | P0 |
| tenant model | impossibilita di servire catene isolate | introdurre tenant/org/store scopes prima di B2B | P0 per enterprise |
| secret/config management | token e provider esposti | secret manager, rotation e config schema | P0 |
| migration/rollback policy | deploy che corrompe dati | expand-contract, backup e rollback documentato | P0 |
| incident/runbook | recovery dipendente da una persona | runbook, owner, escalation e postmortem | P0 |

## 3. Gap importanti dopo il core

- **Admin/backoffice**: gestione catalogo, merge, review OCR, DLQ, provider, capability e audit senza accesso diretto al DB.
- **Reconciliation service**: confronta outbox, code, job status, ledger e proiezioni; ripara divergenze.
- **Scheduler**: import, retention, backup verification, projection rebuild e digest, con lock distribuito.
- **Feature flags/config service**: rollout per tenant, capability e kill switch; audit delle modifiche.
- **Search strategy**: fallback PostgreSQL e criteri misurati per introdurre OpenSearch.
- **Database strategy**: decisione formalizzata in [Architettura dati e strategia database](DATABASE-ARCHITECTURE.md) e ADR-0003; benchmark necessari prima di aggiungere document, search, graph o warehouse.
- **Data export/erasure worker**: export asincrono, tombstone e cancellazione da proiezioni/backup secondo policy.
- **Provider abstraction**: contract per OCR, AI, catalogo, offerte, notifiche e fallback provider.
- **Quota/billing readiness**: usage metering per tenant, limiti e costi provider, anche se il billing e futuro.
- **Webhooks/integration gateway**: firma, replay protection, DLQ e idempotenza per POS/ERP/retailer.
- **Anti-abuse**: quota upload, OCR, AI e API; detection di automazioni anomale.
- **Accessibility/localization**: WCAG 2.2 AA, lingua, unita e timezone.
- **Offline/PWA policy**: coda locale, conflitti, scadenza sessione e limite dei dati offline.
- **Data quality service**: controlli su unita, barcode, nutrienti, allergeni, duplicati e offerte stale.
- **ML governance**: model registry, evaluation set, bias, drift, prompt injection defense e rollback.

## 4. Funzionalita di prodotto non ancora coperte abbastanza

- onboarding e migrazione iniziale da CSV/foto/scontrino;
- gestione confezioni aperte e conversioni di unita;
- sostituzioni equivalenti e allergeni cross-contamination;
- scadenze, FIFO/FEFO e notifiche configurabili;
- ricette per porzioni e consumo parziale;
- acquisti condivisi offline e conflitti multiutente;
- import scontrino e verifica prezzo;
- gestione di prodotti non alimentari se il dominio lo richiedera;
- calendario pasti e pianificazione, separati dal semplice suggerimento;
- gestione minori e profili familiari con privacy distinta;
- preferenze per retailer, distanza, budget e disponibilita locale;
- spiegazione e controllo dell'algoritmo dei suggerimenti.

Le funzioni principali sono ora coperte dai journey UX, ma il loro ordine di rilascio resta da validare con discovery e metriche: non tutto deve entrare nel primo rilascio.

## 5. Rischi architetturali

### Microservizi prematuri

Rischio: troppi processi, contratti e failure mode su un solo PC. Mitigazione: pochi deployable con bounded context e criteri misurati di estrazione.

### Database unico come collo di bottiglia

Rischio: API, worker, ricerca e analytics competono per CPU/IO. Mitigazione: indici e query budget, read model, pool separati, partitioning/replica solo quando misurati.

### Redis come falsa durabilita

Rischio: perdita code o lock trattata come perdita dati. Mitigazione: PostgreSQL/outbox autorevole e reconciliation.

### AI/provider esterni

Rischio: costi, latenza, dati trasferiti, hallucination e vendor lock-in. Mitigazione: adapter, timeout, budget, confidence, human review e provider policy.

### Observability overload

Rischio: Grafana/Loki/Tempo saturano il PC o espongono dati. Mitigazione: profili, sampling, retention, label cardinality e redazione.

### Profilazione involontaria

Rischio: usare log o consumi come pubblicita o inferenza sanitaria senza consenso. Mitigazione: capability opt-in separata, data governance e DPIA.

## 6. Decisioni obbligatorie ancora aperte

- nome e policy del tenant enterprise;
- provider OIDC e gestione MFA/SCIM;
- regioni e requisiti di residenza dati;
- fonti barcode/nutrizione/ricette/offerte e licenze;
- soglie di confidence e chi approva i dati;
- target workload e budget per household/tenant;
- rete domestica, accesso remoto e TLS certificate lifecycle;
- strategy storage esterno e retention backup;
- canali di alerting e reperibilita;
- policy AI e dati inviati ai provider;
- livello di offline support;
- scelta PostgreSQL search vs OpenSearch basata su benchmark;
- supporto mobile nativo o PWA only.

## 7. Cosa non va promesso nel curriculum prima delle prove

Non dichiarare alta disponibilita, zero data loss, exactly-once processing, accuratezza AI garantita, compliance GDPR completa o scaling enterprise solo perche esistono Kubernetes e Grafana. Queste affermazioni richiedono test, evidenze operative, accordi e infrastruttura coerente.
