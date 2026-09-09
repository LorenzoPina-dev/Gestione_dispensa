# Engineering handoff e prossimi passi aziendali

## 1. Obiettivo del pacchetto

Questa documentazione e la baseline da consegnare al team di sviluppo. Non e ancora una autorizzazione a implementare: prima servono decisioni di prodotto, privacy, costo e infrastruttura. Ogni decisione deve essere tracciata in una ADR o in un requisito versionato.

## 2. Cosa farebbe una azienda prima del codice

### Fase A: allineamento e discovery

1. Nominare product owner, tech lead, security/privacy owner e operations owner.
2. Definire target iniziale: household domestico, retailer pilota o entrambi tramite capability flags.
3. Intervistare utenti e operatori per validare flussi di inventario, acquisto e consumo.
4. Confermare paesi, lingue, unita, timezone, retailer, fonti nutrizionali e fonti offerte.
5. Decidere obiettivi misurabili: activation, stock accuracy, suggestion acceptance, p95, RPO/RTO e costo per household.
6. Scrivere threat model, DPIA preliminare e data classification.
7. Approvare budget per hardware, storage esterno, provider OIDC, OCR/AI, notifiche e observability.

**Gate A**: nessun requisito MUST ambiguo; ownership assegnata; rischi legali e provider identificati.

### Fase B: architecture and design review

1. Approvare blueprint e ADR esistenti.
2. Approvare bounded context, ownership dei dati e matrice accessi.
3. Congelare primi contratti OpenAPI, eventi e job.
4. Definire schema registry, versioning e compatibilita.
5. Definire modello di deployment `home-small` e `production`.
6. Definire SLO, error budget e policy incident.
7. Riesaminare recovery tramite tabletop e restore drill progettato.

**Gate B**: architecture review approvata; contratti testabili; failure mode documentati; niente dipendenza nascosta tra servizi.

### Fase C: delivery foundation

1. Creare repository/monorepo, branch protection e CODEOWNERS.
2. Configurare CI: lint, typecheck, unit, integration, contract, security scan e build immagini.
3. Creare ambienti dev, test, staging e production con configurazione separata.
4. Provisionare Compose e k3s/Kubernetes tramite Infrastructure as Code.
5. Configurare secret manager, OIDC, registry, backup e observability as code.
6. Definire migration policy e seed data non personali.
7. Installare dashboard, alert e runbook prima dei primi carichi reali.

**Gate C**: una build riproducibile puo essere promossa; un alert di test arriva; un backup viene ripristinato; un trace attraversa il percorso core.

### Fase D: implementazione incrementale

Ordine raccomandato:

1. identity, household, policy e audit;
2. catalogo manuale e inventario ledger;
3. lista spesa e soglie;
4. ricerca read model;
5. barcode/catalog provider;
6. foto/OCR con revisione;
7. notifiche;
8. ricette e nutrizione;
9. offerte retailer;
10. personalizzazione opt-in;
11. tenancy retailer, backoffice e integrazioni enterprise.

Ogni incremento deve essere rilasciabile e funzionare con capability successive spente.

## 3. Definition of Ready

Una storia entra nello sprint solo se:

- persona, caso d'uso e valore sono chiari;
- requisiti MUST/SHOULD e acceptance criteria sono scritti;
- autorizzazioni e dati personali coinvolti sono identificati;
- input, output, errori, idempotenza e comportamento async/degraded sono definiti;
- dipendenze e owner sono noti;
- telemetria, alert e retention sono previsti;
- test data e piano di migrazione sono disponibili;
- il product owner accetta il rischio residuo.

## 4. Definition of Done

- codice revisionato da almeno un owner del componente;
- test e contract test verdi;
- SAST, dependency, secret e container scan verdi o eccezioni approvate;
- metriche, log, trace e dashboard presenti;
- autorizzazione, audit e privacy verificati;
- migration backward-compatible e rollback documentato;
- runbook e documentazione API/eventi aggiornati;
- alert provato e non rumoroso;
- performance misurata sul profilo previsto;
- release note e rischio residuo registrati.

## 5. Ruoli e ownership minima

| Area | Responsabilita |
|---|---|
| Product owner | priorita, valore, acceptance, stakeholder |
| Tech lead | architettura, ADR, standard, trade-off |
| Domain owner | invarianti e contratti del modulo |
| Security owner | threat model, IAM, vulnerabilita, incident security |
| Privacy/DPO | basi giuridiche, DPIA, retention, diritti |
| QA owner | strategia test, quality gate, release evidence |
| SRE/operations | SLO, capacity, backup, incident e recovery |
| Data/ML owner | provenance, metriche, modelli, bias, rollback |
| Platform owner | CI/CD, registry, runtime, secrets e IaC |

In un progetto personale una persona puo coprire piu ruoli, ma le responsabilita non devono sparire.

## 6. Ambienti e promozione

- **local**: Compose, dati sintetici, profilo minimo;
- **test**: dipendenze reali containerizzate, fixture versionate, test di contratto;
- **staging**: topology simile alla produzione, provider sandbox, chaos controllato;
- **production**: dati reali, accesso ristretto, backup, alert, approval e audit.

Nessun dato reale deve essere copiato in local/test senza anonimizzazione approvata. Le immagini sono immutabili e promosse dallo stesso artifact digest; non si ricostruisce diversamente tra staging e production.

## 7. Release e incident management

- release semantiche e changelog;
- feature flag per capability rischiose;
- canary/rolling solo dove storage e migration lo consentono;
- backward compatibility durante finestra di migrazione;
- rollback tecnico separato da rollback dati;
- incidenti classificati P1/P2/P3 con commander, timeline e comunicazione;
- postmortem blameless per P1/P2 e per perdita dati/security;
- azioni correttive con owner e scadenza.

## 8. Capacity e cost management

Prima di promettere scala enterprise definire workload model:

- household/clienti attivi;
- richieste per secondo e pattern stagionali;
- eventi inventory al giorno;
- foto/OCR per ora;
- import offerte per retailer/area;
- dimensione catalogo e crescita media;
- retention log/trace/backup;
- costo massimo per tenant.

Il dimensionamento deve essere basato su test e budget. Kubernetes abilita scheduling e scaling, ma non elimina il collo di bottiglia del database, della rete, del provider AI o dello storage.

## 9. Criteri di crescita verso retailer

Prima di onboarding di una catena servono:

- tenant isolation verificata con test automatici;
- organizzazioni, negozi, regioni e operatori backoffice;
- import catalogo/POS/ERP con mapping, riconciliazione e DLQ;
- data residency e retention contrattuali;
- SSO enterprise, SCIM o processo equivalente;
- audit export e segregazione dei compiti;
- rate limit e quota per tenant;
- database partitioning/read replicas quando i test lo richiedono;
- object storage e backup multi-zona o equivalente;
- incident SLA e support model;
- DPA, subprocessor register e security questionnaire.

## 10. Change management della documentazione

Ogni modifica a contratto, dati, sicurezza, retention, SLO o topologia richiede:

1. issue con motivazione e impatto;
2. ADR se cambia una decisione architetturale;
3. aggiornamento requisiti e component spec;
4. piano di compatibilita/migrazione;
5. approvazione owner;
6. evidenza test e monitoraggio post-release.

La documentazione ha la stessa disciplina del codice: review, versionamento, link verificati e nessuna promessa non misurata.
