# Readiness audit: cosa manca

## 1. Stato reale del repository

Il repository contiene una baseline documentale avanzata e una prima implementazione tecnica
parzialmente validata. La distinzione attuale è:

- **implementato e validato localmente**: workspace, testkit, contratti HTTP/event/job, config
	tipizzata, primitive osservabilità, migration runner, policy Compose, realm Keycloak, bootstrap
	MinIO, provisioning observabilità, OIDC verifier e authorization policy;
- **materializzato ma non provato end-to-end**: profilo Docker Compose completo, health/readiness
	dei container, login Keycloak, upload MinIO, trace cross-service, alert delivery e restore;
- **non ancora implementato**: persistenza family/membership/QR, catalogo, inventario, shopping,
	worker, scheduler, notifiche, web/PWA e journey utente;
- **non ancora production-ready**: test security/load/resilience/accessibility, backup/restore
	drill reale, scansioni, SLO misurati e approvazioni privacy/security.

Il dettaglio aggiornato dei task e delle evidenze è in [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md).
Il progetto non deve essere presentato come production-ready finché i gate sotto non hanno
evidenze ripetibili.

## 2. Documentazione ed evidenze ancora necessarie

### P0: prima dell'implementazione dei domini

1. **ERD e ownership**: approvare le migration dei bounded context con il migration owner.
2. **OpenAPI**: sostituire i body generici rimasti con schemi operation-specific e completare gli esempi 4xx prima dell'API freeze.
3. **Eventi/job**: completare gli eventuali eventi canonici mancanti e generare validator producer/consumer.
4. **Retention, threat model e DPIA**: ottenere approvazione privacy/security, ancora gate umano.
5. **SLO e runbook**: collegare tutte le query/alert e provare i drill su container e database reali.

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

### P0: foundation eseguibile residua

- avvio reale dei container e health/readiness drill;
- configurazione Redis/queue/outbox applicativa;
- gateway, worker-core e scheduler reali;
- migrazioni dei bounded context e seed sintetici;
- instrumentation collegata ai processi applicativi;
- backup verificato e restore drill PostgreSQL/MinIO;
- security/secret/container scan nella CI;
- schema request/response operation-specific e validator producer/consumer.

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
