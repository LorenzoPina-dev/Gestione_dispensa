# Dispensa intelligente: blueprint tecnico

## 1. Visione e obiettivi

Dispensa intelligente e un prodotto multiutente per nuclei familiari che:

- mantiene una fotografia affidabile delle scorte, delle loro quantita, unita, scadenze e posizioni;
- crea automaticamente una lista della spesa quando una scorta scende sotto la soglia o termina;
- identifica prodotti da barcode, foto/OCR e ricerca manuale, chiedendo conferma quando la confidenza non e sufficiente;
- permette ricerca e filtri avanzati su prodotti, scorte, allergeni, nutrizione e scadenze;
- propone ricette compatibili con le scorte, i vincoli dietetici e il consumo previsto;
- raccoglie offerte da catene e fonti autorizzate, mostrando sempre fonte, timestamp e copertura geografica;
- registra consumi manuali o derivati da eventi confermati e produce statistiche caloriche senza presentarle come consiglio medico.

### Non-obiettivi della prima versione

- diagnosi o prescrizioni nutrizionali;
- acquisto automatico senza conferma dell'utente;
- scraping indiscriminato di siti con divieti o condizioni non compatibili;
- riconoscimento fotografico perfetto di qualsiasi alimento;
- un cluster Kubernetes completo come prerequisito per eseguire l'MVP.

## 2. Principi architetturali

1. **Domain first**: il dominio della dispensa non dipende da provider esterni o framework HTTP.
2. **Modular services with progressive deployment**: confini di servizio, contratti e code fin dall'inizio; deploy separati solo per i componenti che hanno un motivo reale per scalare o isolarsi.
3. **Explicit data quality**: ogni dato acquisito automaticamente ha origine, timestamp, confidence e stato di revisione.
4. **Human in the loop**: barcode/OCR/AI suggeriscono; l'utente conferma le modifiche ambigue.
5. **Secure by default**: deny-by-default, minimo privilegio, isolamento per household, audit e revoca delle sessioni.
6. **Event-aware**: le modifiche importanti producono eventi di dominio/outbox, senza affidarsi a chiamate distribuite non affidabili.
7. **Observable by design**: correlation id, metriche, log strutturati, trace e audit separati.
8. **Portability**: PostgreSQL, S3-compatible object storage e OpenTelemetry riducono il lock-in.

### Decisione architetturale: servizi indipendenti, infrastruttura progressiva

La piattaforma sara progettata come un insieme di componenti separabili, ma non tutti i componenti devono diventare immediatamente microservizi di rete. Questa distinzione e importante:

- un **modulo** ha un confine di dominio e un contratto;
- un **servizio** e un modulo o gruppo di moduli con processo, deploy e scaling propri;
- un **container** e solo l'unita di packaging, non implica automaticamente un microservizio;
- un **pod Kubernetes** e una scelta operativa da introdurre quando il beneficio supera il costo.

La topologia iniziale consigliata sul vecchio PC e composta da container indipendenti ma leggeri:

1. `web`: Next.js;
2. `api`: API sincrone e regole transazionali;
3. `worker-core`: consumi, soglie, lista spesa e notifiche;
4. `worker-integrations`: barcode/catalogo, OCR, ricette, offerte e nutrizione;
5. `postgres`: stato autorevole;
6. `redis`: code e cache;
7. `object-storage`: foto e allegati.

La separazione dei worker permette di spegnere i componenti costosi e riattivarli senza interrompere inventario e lista della spesa. Il passaggio a Kubernetes non richiede riscrittura: si convertono i container in Deployment, StatefulSet o servizi gestiti, mantenendo API ed eventi.

## 3. Stack raccomandato

### Applicazione

- **Web**: Next.js + React + TypeScript, App Router, rendering server-side dove utile.
- **API/BFF**: NestJS + TypeScript, REST JSON versionata (`/api/v1`), OpenAPI generata dal codice.
- **Contratti**: OpenAPI per client esterni; Zod/DTO per validazione runtime; eventi con JSON Schema versionato.
- **UI**: Tailwind CSS + componenti accessibili coerenti; React Hook Form; TanStack Query per dati client-side.
- **Ricerca**: PostgreSQL full-text + trigram all'inizio; OpenSearch quando volume e requisiti di ranking lo giustificano.

### Dati e asincronia

- **Database autorevole**: PostgreSQL 16+, migrazioni versionate, `pgcrypto`, full-text/trigram search e Row Level Security come ulteriore barriera. Famiglie, membership, ruoli, inviti QR, inventario, outbox e audit restano relazionali per vincoli e consistenza.
- **Cache e code**: Redis; BullMQ per job con retry, backoff, deduplicazione e dead-letter queue.
- **File**: storage S3-compatible per foto, ricevute e immagini prodotto; URL prefirmati e antivirus in ingresso.
- **Database specializzati opzionali**: OpenSearch per ricerca/ranking e graph database per raccomandazioni multi-hop solo come proiezioni ricostruibili, dopo benchmark; nessun graph database e necessario per la struttura account/famiglia.
- **Configurazione**: variabili d'ambiente solo per riferimenti; secret manager in produzione.

### Identita e operativita

- **Identity provider**: OIDC/OAuth2 con provider gestito o Keycloak. L'app non conserva password se non esiste una ragione operativa forte.
- **Osservabilita**: OpenTelemetry Collector, Prometheus, Grafana, Alertmanager, Loki e Tempo.
- **Quality gate**: ESLint, Prettier, TypeScript strict, Vitest, Playwright, Pact o test di contratto, Trivy, Dependabot/Renovate e CI su pull request.
- **Runtime iniziale**: Docker Compose su Linux, con profilo principale `family-local` completamente locale: API, gateway, PostgreSQL, Redis, MinIO, Keycloak, worker-core, scheduler, OpenTelemetry, Prometheus, Grafana, Alertmanager, Loki e Tempo.
- **Runtime intermedio**: Docker Swarm o k3s su un singolo nodo, solo dopo aver bisogno di rolling update, restart policy, secret e scheduling dichiarativo.
- **Runtime di scala**: Kubernetes/k3s multi-node o servizio Kubernetes gestito, con autoscaling dei worker e database esterno/gestito quando il nodo locale non basta.

La piattaforma mantiene gli stessi contratti applicativi in entrambi gli ambienti. Il primo rilascio e `family-local` e non richiede cloud; cambiano solo profilo di deployment, retention, numero di repliche e backend stateful: Compose/k3s single-node per uso domestico; Kubernetes multi-node, storage ridondato e database gestito o replicato per installazioni professionali.

### Scelta deliberata

NestJS separa API, autenticazione, job e integrazioni dal frontend. I worker sono processi distinti per consentire scaling e spegnimento selettivi. PostgreSQL mantiene la consistenza delle scorte, mentre Redis assorbe il lavoro asincrono. Le integrazioni e l'AI sono isolate per non bloccare il flusso utente e per poter cambiare provider senza modificare il dominio.

## 4. Architettura logica

```text
[Browser / PWA]
       |
       v
[Next.js Web] ---- OIDC ---- [Identity Provider]
       |
       v
[API service]
  |             |                 |
  v             v                 v
[Core worker] [Integration worker] [Notification worker]
  |             |                 |
  +-------------+-----------------+
                v
         [Outbox / Redis queues]
                |
       +--------+---------+
       v                  v
 [PostgreSQL]          [S3 storage]
       |
       +-- [Catalog / offers / AI / retailer adapters]
```

### Moduli applicativi

- `identity-access`: sessione, mapping identita, ruoli e policy di accesso.
- `family`: profili famigliari, membership, ruoli, inviti QR, famiglia attiva e preferenze condivise.
- `catalog`: prodotto canonico, barcode, sinonimi, brand, categorie, nutrizione, allergeni.
- `inventory`: ubicazione, lotti, scadenze, quantita, soglie, rettifiche e stato.
- `consumption`: prelievi, sprechi, consumi stimati e loro origine.
- `shopping`: lista, righe, aggregazione, priorita, completamento e suggerimenti offerta.
- `recognition`: upload, barcode decode, OCR/vision, match catalogo e revisione.
- `recipes`: ricette, disponibilita ingredienti, sostituzioni, preferenze e ranking.
- `offers`: fonti, importazioni, normalizzazione, validita e localizzazione.
- `nutrition`: calcolo trasparente, porzioni, diario e disclaimer.
- `notifications`: email/push/in-app e preferenze.
- `audit`: eventi di sicurezza e modifiche sensibili, append-only.
- `platform`: health checks, outbox, feature flags, rate limiting, configurazione.

Ogni modulo possiede controller, application service, domain model, repository interface e adapter. Un modulo non legge direttamente le tabelle di un altro modulo: usa application service o eventi tipizzati.

### Mappa dei deployable component

| Componente | Responsabilita | Scaling | Attivo nell'MVP |
|---|---|---:|---:|
| `web` | UI, PWA, sessione browser | orizzontale | si |
| `api` | comandi, query, policy, OpenAPI | orizzontale | si |
| `worker-core` | movimenti, soglie, lista spesa | per coda | si |
| `worker-integrations` | barcode, OCR, ricette, offerte, nutrizione | per coda/provider | opzionale |
| `worker-notifications` | email, push e digest | per coda | opzionale |
| `search-indexer` | proiezioni e indice avanzato | per backlog | opzionale |
| `postgres` | consistenza e stato autorevole | verticale/replica | si |
| `redis` | cache, lock e code | verticale/replica | si |
| `keycloak` | OIDC locale | verticale/replica | si |
| `minio` | object storage locale | storage/replica | si |
| `otel-collector` | raccolta telemetria | verticale/replica | si |
| `prometheus` | metriche e alert rules | storage/replica | si |
| `grafana` | dashboard | verticale/replica | si |
| `alertmanager` | routing alert | verticale/replica | si |
| `loki` | log | storage/replica | si |
| `tempo` | trace | storage/replica | si |

Ogni componente deve avere immagine versionata, health check, configurazione validata all'avvio, limiti CPU/memoria e graceful shutdown. Un componente opzionale non deve essere importato come dipendenza obbligatoria dall'API: l'assenza produce uno stato esplicito (`UNAVAILABLE` o `PENDING`), non un crash a cascata.

## 5. Flussi principali

### 5.1 Inserimento da barcode

1. Il client legge il codice localmente con ZXing/ML Kit e invia solo il valore.
2. L'API normalizza il barcode e controlla cache/catalogo locale.
3. Se manca, crea un job `catalog.lookup.requested` verso fonti autorizzate.
4. Il worker importa la risposta, conserva la provenienza e calcola la confidence.
5. L'utente conferma nome, formato, unita, quantita e scadenza.
6. Il comando `inventory.stock.received` crea la scorta e aggiorna la proiezione di ricerca.

### 5.2 Inserimento da foto

1. Upload diretto su S3 tramite URL prefirmato, con limite dimensione/formato.
2. Scansione antivirus e rimozione EXIF non necessaria.
3. Job di OCR/vision con timeout, provider configurabile e nessun dato sensibile oltre il necessario.
4. Match su barcode/OCR/immagine; risultato con `confidence`, campi proposti e motivazione.
5. Stato `PENDING_REVIEW` finche l'utente non conferma.
6. Conservazione della foto secondo retention configurabile; cancellazione su richiesta.

### 5.3 Scorta terminata e lista della spesa

1. Ogni movimento e registrato come evento con quantita e motivo.
2. La policy valuta `quantity <= reorderPoint`, scadenza e preferenze.
3. Viene emesso un comando idempotente per aggiungere o incrementare la riga nella lista attiva.
4. La lista aggrega per prodotto canonico, unita e confezione, senza duplicati.
5. L'utente puo accettare, modificare, posticipare o ignorare il suggerimento.

### 5.4 Ricette

Il ranking usa ingredienti disponibili, ingredienti mancanti, scadenze prossime, allergeni esclusi, tempo e preferenze. Il sistema mostra la motivazione e non inventa dati nutrizionali: usa ricette verificate o marca chiaramente ogni generazione AI come proposta da controllare.

### 5.5 Offerte

Ogni adapter importa dati da API/feed/licenze compatibili. Un normalizzatore associa l'offerta al prodotto canonico tramite barcode, SKU e matching controllato. L'interfaccia mostra negozio, area, periodo, fonte e data di aggiornamento. Un'offerta scaduta non deve essere presentata come attiva.

## 6. Modello dati

Tutte le tabelle hanno `id` UUID, `created_at`, `updated_at` e, quando rilevante, `created_by`. Le quantita sono `numeric`, mai floating point. Le date sono UTC; la timezone dell'household serve solo per la presentazione e le regole locali.

Entita principali:

- `users`, `households`, `household_members`, `roles`, `permissions`, `invitations`;
- `products`, `product_identifiers`, `product_aliases`, `categories`, `brands`;
- `nutrition_profiles`, `allergens`, `product_allergens`, `data_sources`, `data_provenance`;
- `locations`, `stock_items`, `stock_lots`, `stock_movements`, `stock_thresholds`;
- `shopping_lists`, `shopping_list_items`;
- `consumption_events`, `waste_events`, `meal_logs`;
- `recipes`, `recipe_ingredients`, `recipe_tags`, `recipe_sources`;
- `offers`, `offer_items`, `retailer_stores`, `retailer_sources`;
- `recognition_jobs`, `recognition_candidates`, `media_assets`;
- `outbox_events`, `inbox_events`, `audit_events`, `notification_preferences`.

### Invarianti

- Un utente vede solo household di cui e membro.
- Un `stock_item` appartiene a un solo household e a un prodotto canonico.
- Un movimento e immutabile; correzioni e storni sono nuovi movimenti.
- La quantita non puo diventare negativa senza una rettifica esplicita.
- Gli eventi outbox hanno chiave idempotente unica.
- I dati importati non sovrascrivono silenziosamente una modifica manuale confermata.

## 7. API e interfacce tra componenti

### REST pubblico

- `GET /api/v1/products?query=&category=&allergenFree=`
- `POST /api/v1/recognition/jobs`
- `GET /api/v1/recognition/jobs/{id}`
- `POST /api/v1/inventory/items`
- `POST /api/v1/inventory/items/{id}/movements`
- `GET /api/v1/inventory/search`
- `GET /api/v1/shopping-lists/active`
- `POST /api/v1/shopping-lists/{id}/items/{itemId}/complete`
- `GET /api/v1/recipes/suggestions`
- `GET /api/v1/offers?productId=&area=`
- `GET /api/v1/nutrition/summary?from=&to=`

Regole API:

- envelope coerente per errori: `code`, `message`, `details`, `traceId`;
- paginazione cursor-based sulle liste grandi;
- `Idempotency-Key` su comandi ripetibili;
- `ETag`/`If-Match` per evitare sovrascritture concorrenti;
- rate limit distinto per letture, comandi, upload e riconoscimento;
- nessun errore interno, token o prompt provider nei messaggi al client.

### Eventi interni

Formato minimo: `eventId`, `eventType`, `eventVersion`, `occurredAt`, `aggregateId`, `householdId`, `traceId`, `payload`.

Eventi iniziali:

- `inventory.stock.received.v1`
- `inventory.stock.consumed.v1`
- `inventory.reorder-point-reached.v1`
- `shopping.item.suggested.v1`
- `recognition.completed.v1`
- `catalog.product-updated.v1`
- `offer.imported.v1`
- `recipe.suggestion-generated.v1`

Gli eventi sono notifiche; la consistenza transazionale resta nel database del modulo proprietario. L'outbox viene scritto nella stessa transazione del cambiamento e pubblicato da un worker.

## 8. Accesso, sicurezza e privacy

### Autenticazione

- OIDC Authorization Code + PKCE per web e mobile futuro.
- Cookie di sessione `HttpOnly`, `Secure`, `SameSite=Lax`; mai token in localStorage.
- MFA delegata al provider per ruoli privilegiati.
- Rotazione/revoca sessioni dopo cambio credenziali o modifica ruoli.

### Autorizzazione

RBAC per il ruolo (`OWNER`, `MANAGER`, `MEMBER`, `VIEWER`) e ABAC per `householdId`, risorsa, azione e contesto. Ogni endpoint applica una policy esplicita. I worker ricevono identity/service account con scope limitati.

### Protezione applicativa

- validazione input e output con schema;
- query parametrizzate e ORM/query builder senza SQL concatenato;
- CSRF protection sui comandi basati su cookie;
- CSP, HSTS, frame-ancestors, X-Content-Type-Options e Referrer-Policy;
- CORS allowlist; nessun `*` in produzione;
- upload con allowlist MIME, dimensione, antivirus, quota e nomi generati;
- SSRF prevention per URL forniti da utenti o connettori;
- rate limiting, account lockout gestito dall'IdP e protezione abuso AI/OCR;
- cifratura in transito e a riposo, backup cifrati e testati.

### Privacy e GDPR

Base giuridica e informative separate per account, foto, nutrizione e offerte. Minimizzazione, retention configurabile, export e cancellazione account. I dati alimentari possono diventare sensibili per inferenza: accesso limitato, auditato e mai usato per profiling pubblicitario senza consenso esplicito. Le foto non vengono conservate oltre il necessario.

## 9. Qualita, test e delivery

Piramide di test:

- unit test su regole di quantita, soglie, ranking e policy;
- integration test PostgreSQL/Redis reali tramite container;
- contract test API/eventi e adapter esterni con fixture versionate;
- E2E Playwright per onboarding, inserimento, consumo e lista spesa;
- test di sicurezza SAST, dependency scan, secret scan, DAST su ambiente di test;
- test di carico su ricerca, import offerte e job di riconoscimento.

CI obbligatoria: typecheck, lint, test, build, migration check, scans e artifact firmato. Deploy con migrazioni backward-compatible, health/readiness probe, canary o rolling release e rollback documentato.

## 10. Osservabilita, monitoring e alerting

La telemetria e una capability infrastrutturale separata dal dominio applicativo. Tutti i servizi emettono metriche, log strutturati e trace con lo stesso `traceId`; nessun servizio implementa dashboard o notifiche proprie.

### Stack standard

- **OpenTelemetry SDK + Collector**: strumentazione e raccolta uniforme di trace, metriche e log, con batching, sampling, redazione e retry;
- **Prometheus**: scraping e storage delle metriche time-series applicative e infrastrutturali;
- **Grafana**: dashboard operative, drill-down da SLO a servizio, coda, database e singola trace;
- **Alertmanager**: deduplicazione, grouping, silenziamento, routing e escalation degli alert;
- **Loki**: log strutturati ricercabili, con retention e label controllate;
- **Tempo**: tracing distribuito, correlato a Grafana, log e metriche;
- **Node Exporter/kube-state-metrics**: metriche host e stato Kubernetes.

Grafana visualizza e correla i segnali, ma gli alert critici devono essere valutati da Prometheus/Alertmanager in modo indipendente dalla disponibilita della UI. Le regole sono versionate come codice e provate in CI.

### Profili di deployment

| Profilo | Telemetria | Retention | Uso |
|---|---|---|---|
| `home-small` | Prometheus + Grafana + Alertmanager; Collector leggero | 7-14 giorni | vecchio PC, costi minimi |
| `home-plus` | aggiunge Loki e Tempo | 14-30 giorni | troubleshooting completo |
| `production` | stack replicato, storage persistente, remote write/backup | secondo compliance | catene e carichi elevati |

Loki e Tempo sono attivabili nel profilo minimo, ma l'applicazione non deve dipendere dalla loro disponibilita. La perdita della telemetria non deve interrompere inventario, API o code.

## 11. Affidabilita e operativita

Le politiche operative dettagliate sono definite in [Operazioni, resilienza e osservabilità](OPERATIONS-AND-RESILIENCE.md). In sintesi: il gateway e sempre attivo, `api`, PostgreSQL, Redis e `worker-core` costituiscono il percorso minimo; OCR, AI, offerte, notifiche e indicizzazione sono capability attivabili e degradabili. I producer usano outbox transazionale, i consumer usano ack dopo persistenza, idempotenza, backoff, circuit breaker e DLQ. Redis non e fonte autorevole e le proiezioni sono ricostruibili.

Su un singolo vecchio PC non e possibile garantire alta disponibilita: il recovery richiede almeno backup esterno cifrato e restore verificato. RPO/RTO, replica e alerting devono essere dichiarati sulla base dell'infrastruttura realmente disponibile, non solo della presenza di Kubernetes.

SLO iniziali da confermare con misure reali:

- API lettura p95 < 400 ms;
- comandi inventario p95 < 600 ms;
- disponibilita mensile 99.9%;
- job riconoscimento: esito o stato esplicito entro 60 s nel 95% dei casi;
- perdita dati: RPO <= 15 min, RTO <= 1 h.

Metriche: latenza, error rate, job backlog, eta del job piu vecchio, retry/DLQ, consumer lag, query lente, cache hit, saturazione CPU/RAM/disco, stato WAL, backup/restore, confidence recognition, mismatch catalogo, lista generata e tasso di conferma utente. Ogni alert deve avere soglia, finestra, severita, owner, runbook e link al trace/dashboard; non si usano alert senza azione associata.

Backup PostgreSQL completo settimanale, snapshot giornalieri, WAL/PITR verso storage esterno quando disponibile e restore drill mensile. Redis resta ricostruibile da PostgreSQL/outbox. La replica richiede un secondo host e non viene considerata alta disponibilita sullo stesso PC. Runbook per provider esterno indisponibile, Redis down, backlog code, DLQ, migrazione fallita, disco pieno, compromissione account, restore e cancellazione dati.

## 12. Roadmap incrementale

### Fase 0: fondazioni

Monorepo, CI, Docker Compose, NestJS/Next.js, PostgreSQL, OIDC, migrazioni, logging, OpenAPI, health check e modello household.

### Fase 1: MVP affidabile

Catalogo manuale/barcode, stock e movimenti, soglie, lista della spesa, ricerca, audit e PWA responsive.

### Fase 2: automazione controllata

OCR/foto con revisione, import Open Food Facts o fonte equivalente, notifiche, ricette basate su dati verificati e nutrizione per porzioni.

### Fase 3: intelligence e offerte

Ranking personalizzato, previsione consumi, connettori retailer autorizzati, normalizzazione offerte per area e dashboard sprechi/calorie.

### Fase 4: scala

Read models dedicati, OpenSearch, worker separati, autoscaling, replica database, mobile client e feature flag per rollout progressivi.

## 13. Decisioni da chiudere prima dell'implementazione

- paese, catene e aree geografiche per le offerte;
- provider OIDC e policy MFA;
- budget per OCR/vision e limiti di utilizzo;
- fonte nutrizionale primaria e livello di verifica;
- retention delle foto e posizione dei dati;
- modello commerciale e eventuali consensi per offerte/promozioni;
- numero atteso di household, prodotti e job giornalieri;
- target iniziale: solo web/PWA o anche app nativa.

Queste decisioni cambiano costi, compliance e scelta dei provider, ma non devono cambiare i confini del dominio descritti sopra.
