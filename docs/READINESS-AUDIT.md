# Readiness audit: cosa manca

## 1. Stato reale del repository

Il repository contiene ora una baseline documentale P0 avanzata e ha congelato il primo target `family-local`, ma non contiene ancora applicazione, infrastruttura eseguibile o pipeline CI. La distinzione e importante:

- **documentato**: decisioni, requisiti, flussi, contratti concettuali e criteri;
- **materializzato come documentazione**: product brief, glossario, OpenAPI YAML, ERD, eventi, autorizzazioni, configurazione, retention, SLO e runbook; restano da validare e approvare;
- **specificato ma non materializzato**: manifest, dashboard, alert rules, migration files, validator CI e runbook automatizzati;
- **non ancora presente**: codice, test runtime, immagini, migrazioni, ambienti e prove operative.

Il progetto non deve essere presentato come production-ready finche i gate sotto non hanno evidenze ripetibili.

## 2. Documentazione ancora necessaria

### P0: prima di iniziare lo sviluppo

1. **Product brief e success metrics**: problema, personas, MVP, metriche activation/retention/stock accuracy e criteri di esclusione.
2. **Glossario e ubiquitous language**: differenza formale tra user, family, household, tenant, store, product, stock item, lot, package, serving e movement.
3. **ERD versionato**: disponibile in [ERD e ownership dati](DATA-MODEL-ERD.md), da approvare con migration owner.
4. **OpenAPI versionata**: baseline disponibile in [openapi.yaml](openapi.yaml); il perimetro completo degli endpoint e in [API-ENDPOINT-CATALOG.md](API-ENDPOINT-CATALOG.md) e deve essere materializzato/validato prima dell'API freeze.
5. **JSON Schema eventi/job**: policy e payload disponibili in [EVENT-SCHEMAS.md](EVENT-SCHEMAS.md), da materializzare nel registry/validator.
6. **Matrice autorizzazioni**: disponibile in [AUTHORIZATION-MATRIX.md](AUTHORIZATION-MATRIX.md), da coprire con test automatici.
7. **Configuration contract**: disponibile in [CONFIGURATION-CONTRACT.md](CONFIGURATION-CONTRACT.md), da validare all'avvio dei servizi.
8. **Data retention schedule**: disponibile in [RETENTION-AND-DATA-LIFECYCLE.md](RETENTION-AND-DATA-LIFECYCLE.md), da approvare con privacy/legal.
9. **SLO/error budget catalog**: disponibile in [SLO-ERROR-BUDGET.md](SLO-ERROR-BUDGET.md), da collegare a query Prometheus.
10. **Runbook operativi**: disponibili in [RUNBOOKS.md](RUNBOOKS.md), da provare con tabletop e drill reali.
11. **Threat model e DPIA approvati**: i documenti tecnici esistono, ma l'approvazione di security/privacy resta un gate umano.

### P1: prima del primo rilascio beta

- wireframe o design system per flussi core e stati errore/offline;
- piano accessibilità e test WCAG;
- benchmark plan con workload domestico e target retailer;
- test data catalog e fixture anonimizzate;
- provider matrix con costi, rate limit, SLA, dati trasferiti e fallback;
- migration/rollback playbook con esempi;
- test plan E2E, contract, security, performance, chaos e recovery;
- dashboard Grafana e alert rules provisioning-as-code;
- SBOM, vulnerability policy e software supply-chain policy;
- support model, incident severity matrix e comunicazioni;
- piano export/erasure e verifica delle richieste privacy;
- ADR per offline, search, identity provider e fonti dati quando le scelte saranno definitive.
- deployment contract, policy migrazioni e quality gate documentale sono disponibili ma da verificare in CI/staging.

### P2: prima della scala enterprise

- tenant/org/store ERD e matrice delega backoffice;
- SSO/SCIM e lifecycle utenti aziendali;
- POS/ERP/webhook contracts;
- data warehouse model e data product catalog;
- model cards, evaluation set, drift/bias monitoring e AI provider governance;
- capacity model, cost allocation, quota e usage metering;
- multi-region/data residency design;
- disaster recovery tra regioni o siti;
- compliance evidence pack, DPA, subprocessor register e security questionnaire.

## 3. Artefatti di progetto mancanti

### P0: foundation eseguibile

- codice web/API/worker;
- monorepo e package boundaries;
- Dockerfile e Docker Compose profili;
- profilo Compose `family-local` con Grafana, DB, Redis e servizi locali;
- migrazioni PostgreSQL e seed sintetici;
- configurazione Redis/queue/outbox;
- gateway e OIDC configuration;
- object storage policy e upload quarantine;
- health/readiness/startup endpoint;
- OpenTelemetry Collector e instrumentation baseline;
- Prometheus/Grafana/Alertmanager minimi;
- CI con lint, typecheck, test, build e scan;
- secret handling e `.env.example` senza segreti;
- backup verificato e script/procedura restore;
- schema registry materializzato o validatore di contratto.

### P1: prodotto beta

- onboarding e famiglia/QR;
- catalogo manuale/barcode;
- inventory ledger e consumo;
- lista spesa e soglie;
- ricerca e filtri;
- notifiche;
- test E2E dei journey core;
- reconciliation e scheduler;
- admin/backoffice minimo per review, DLQ e catalogo;
- export/cancellazione dati;
- dashboard UX e metriche prodotto.

### P2: capacità avanzate

- OCR/vision e receipt import;
- ricette e nutrizione con provenance;
- offerte retailer autorizzate;
- personalizzazione opt-in;
- OpenSearch se benchmark richiesto;
- analytics warehouse;
- provider fallback e model governance;
- tenancy enterprise, POS/ERP, SSO/SCIM;
- graph projection solo se il caso recommendation lo dimostra.

## 4. Evidenze obbligatorie per dichiarare una milestone

| Milestone | Evidenza minima |
|---|---|
| Architecture approved | ADR, threat model, ERD, contracts, owner approvati |
| Local foundation | Compose avviabile, migration, seed, health e trace |
| Internal alpha | journey core, test automatici, authz, backup/restore |
| Beta | E2E, security scan, alert drill, accessibility, recovery test |
| Production pilot | SLO misurati, error budget, runbook, rollback, privacy evidence |
| Enterprise ready | load test, tenant isolation, DR multi-node, support SLA, compliance pack |

## 5. Ordine professionale dei prossimi passi

1. chiudere product brief, glossario e le poche decisioni aperte non bloccanti;
2. approvare ERD e matrice autorizzazioni;
3. materializzare OpenAPI, JSON Schema e configuration contract;
4. costruire foundation `family-local` riproducibile con Docker Compose;
5. implementare identity/family/inventory/lista con test e osservabilita;
6. eseguire restore, security e failure tests prima di aggiungere AI;
7. validare UX con utenti reali;
8. aggiungere capability opzionali una alla volta con benchmark;
9. misurare workload e costi;
10. introdurre Kubernetes/scaling e database specializzati solo sulla base delle misure.

## 6. Rischi se si procede senza chiudere i gap

- contratti incompatibili tra servizi;
- dati duplicati o perdita di ownership;
- QR e membership vulnerabili;
- rollback impossibili dopo migration;
- costi AI/offerte non controllati;
- dashboard senza alert realmente azionabili;
- profili utente creati senza base privacy;
- database e Kubernetes aggiunti prima di conoscere il workload;
- progetto presentato come enterprise senza prove di isolamento, carico e recovery.

## 7. Criterio finale

La documentazione e sufficiente per iniziare una fase di design review e planning, non per dichiarare il prodotto pronto. Il primo obiettivo professionale non e aggiungere altri servizi: e trasformare contratti e decisioni in artefatti versionati, testabili e riproducibili.
