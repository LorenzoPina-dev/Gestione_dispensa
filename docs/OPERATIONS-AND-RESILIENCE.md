# Operazioni, resilienza e osservabilita

Questo documento definisce come il sistema continua a funzionare quando un componente, una dipendenza o il server ha problemi. Le politiche sono progettate per un singolo vecchio PC, ma non fingono che un singolo nodo possa fornire alta disponibilita: contro incendio, furto, guasto del disco o corruzione totale serve una copia esterna.

## 1. Classificazione dei componenti

### Sempre attivi

- `gateway`: ingresso unico, TLS, autenticazione, autorizzazione, rate limit, routing e correlation id;
- `api`: comandi e query essenziali;
- `family`: membership, autorizzazioni di contesto e inviti QR;
- `postgres`: stato autorevole;
- `redis`: code e lock, con persistenza configurata;
- `worker-core`: movimenti scorte, soglie e lista spesa;
- `web`: interfaccia principale.
- nel profilo `family-local`: `keycloak`, `minio`, `otel-collector`, `prometheus`, `grafana` e `alertmanager` sono inclusi; Loki/Tempo possono essere fermati solo per recupero risorse, mai il core.

### Attivabili on demand

- `worker-integrations`: barcode remoto, OCR/vision, import catalogo, offerte e provider AI;
- `worker-recipes`: ranking o generazione ricette;
- `worker-nutrition`: calcoli e aggregazioni non essenziali;
- `worker-notifications`: email, push e digest;
- `search-indexer`: indice avanzato ricostruibile;
- `scheduler`: import pianificati e manutenzione.

La funzione di attivazione non appartiene alla logica di dominio e non deve essere implementata come `docker start` dentro l'API. Il gateway verifica un registry di capability e invia il lavoro alla coda relativa. Un controller operativo separato, con permessi limitati sul runtime, puo avviare o fermare i worker in base a configurazione, backlog e risorse. In Compose usa profili e un processo supervisor; in k3s usa Deployment, replica minima e scaling policy. Il profilo `family-local` mantiene sempre attivi core, identity, storage locale e osservabilita minima.

### Regola di degradazione

Se una capability opzionale e spenta o indisponibile:

- l'API risponde con dati core e stato `PENDING`, `DEGRADED` o `UNAVAILABLE`;
- il comando non viene perso: resta nell'outbox/coda oppure viene registrato come task differito;
- l'utente vede cosa manca e quando e stato tentato;
- non si crea una catena di retry sincroni dentro la richiesta HTTP.

## 2. Gateway e routing delle capability

Il gateway e un reverse proxy/API gateway, non un orchestratore privilegiato. Le responsabilita sono:

1. terminare TLS e applicare security headers;
2. validare sessione, token, tenant/household e permessi;
3. assegnare `traceId`, `requestId` e `actorId`;
4. applicare timeout, rate limit, quota e body limit;
5. instradare solo verso endpoint registrati e autorizzati;
6. esporre lo stato della capability senza rivelare dettagli interni;
7. restituire `202 Accepted` per lavori asincroni con `jobId` e stato consultabile.

Il registry contiene `capability`, `endpoint`, `version`, `health`, `enabled`, `queue`, `maxConcurrency`, `timeout`, `requiredScopes` e `lastSeen`. Il registry ha una configurazione dichiarativa versionata; il gateway conserva una cache locale dell'ultimo stato valido per evitare che una caduta del registry renda inutilizzabile il core.

Il gateway non attiva servizi per ogni singola chiamata: questa scelta produrrebbe latenza, race condition e rischio di escalation. La capability viene attivata da policy operativa su richiesta, backlog o schedule; la prima chiamata crea un job e il worker puo essere gia caldo oppure avviarsi entro il tempo previsto.

## 3. Producer, broker e consumer

### Pipeline

```text
HTTP command
  -> API transaction
  -> domain change + outbox row
  -> outbox publisher
  -> durable queue/topic
  -> consumer group
  -> idempotent handler
  -> result event/status
```

Il producer non chiama direttamente il provider lento. Scrive il cambiamento e l'outbox nella stessa transazione PostgreSQL. Il publisher consegna a Redis Streams/BullMQ e marca l'evento pubblicato solo dopo conferma. Per flussi ad alto valore si mantiene l'evento su PostgreSQL come fonte di replay.

Ogni consumer deve avere:

- `consumer group` e concorrenza configurabile;
- prefetch limitato e backpressure;
- ack solo dopo persistenza del risultato;
- timeout per job e heartbeat/visibility timeout;
- idempotency key (`eventId` o `jobId`) con tabella inbox/deduplica;
- retry con backoff esponenziale e jitter;
- limite massimo di tentativi;
- dead-letter queue con motivo, stack sanitizzato, payload referenziato e timestamp;
- replay amministrativo dopo correzione, mai retry infinito automatico.

### Classificazione errori

- **Transient**: timeout, 429, 502/503, lock temporaneo. Retry limitato.
- **Permanent**: schema invalido, barcode impossibile, permesso negato. DLQ e stato `FAILED` spiegabile.
- **Poison message**: errore ripetibile sullo stesso payload. Isolamento immediato in DLQ per non bloccare la coda.
- **Dependency unavailable**: circuit breaker aperto, task differito e capability degradata.

Un consumer lento non deve impedire ai consumer di altre code di lavorare. Le code per OCR, offerte, ricette e notifiche sono separate; le priorita sono esplicite e `worker-core` ha risorse riservate.

## 4. Politica di retry e consistenza

Valori iniziali, da calibrare con test:

| Caso | Tentativi | Backoff | Esito |
|---|---:|---|---|
| timeout provider | 5 | 5s, 30s, 2m, 10m, 30m | DLQ/provider degraded |
| HTTP 429 | 5 | `Retry-After` + jitter | task differito |
| HTTP 4xx permanente | 0 | nessuno | `FAILED` |
| errore DB transitorio | 3 | 250ms, 1s, 4s | rollback transazione |
| errore serializzazione | 0 | nessuno | DLQ e alert |

Mai ritentare operazioni non idempotenti senza chiave di idempotenza. Le API usano `Idempotency-Key`; gli eventi usano `eventId`; gli adapter esterni usano una chiave per sorgente, prodotto e finestra temporale.

Il sistema accetta **at-least-once delivery** e rende gli handler idempotenti. Non si dichiara exactly-once: e una promessa fragile su reti e processi distribuiti.

## 5. Protezione dati e recovery

### PostgreSQL

- volume separato dal sistema operativo;
- WAL archiviato continuamente su storage esterno quando disponibile;
- snapshot giornaliero cifrato;
- backup completo settimanale e retention 7/30/365 giorni secondo policy;
- verifica automatica che i backup siano leggibili;
- restore drill mensile su ambiente isolato;
- migrazioni backward-compatible e backup/snapshot prima delle migration distruttive;
- replica solo quando esiste un secondo host: sullo stesso PC non e alta disponibilita.

### Redis

Redis e cache e broker, non la fonte autorevole degli inventari. Si abilita AOF con `appendfsync everysec` e snapshot, ma ogni job importante resta ricostruibile da outbox/PostgreSQL. Dopo perdita Redis si ricreano code e proiezioni; i job non confermati vengono ripubblicati da un processo di reconciliation.

### Object storage

Foto e allegati usano versioning, checksum, cifratura e retention. Backup su disco esterno o storage remoto con verifica checksum. Il database conserva metadati e stato, non considera la disponibilita temporanea di una foto come unica fonte dell'operazione confermata.

### RPO/RTO realistici

- solo vecchio PC: nessuna garanzia di disponibilita; RPO dipende dall'ultimo backup esterno;
- PC + disco esterno sincronizzato: RPO massimo teorico dell'intervallo di sincronizzazione;
- PC + copia remota cifrata: target RPO 15 minuti e RTO 1 ora, da verificare con drill;
- alta disponibilita reale: almeno due nodi e storage/database replicati.

Procedura di recovery: dichiarare incidente, isolare il componente, proteggere le evidenze, ripristinare prima PostgreSQL, verificare migrazioni e integrita, ricostruire Redis, riavviare `worker-core`, ripubblicare outbox non consegnati, ricostruire proiezioni, riattivare capability opzionali una alla volta e chiudere con postmortem.

## 6. Health, readiness e circuit breaker

Ogni servizio espone:

- `/health/live`: processo attivo, senza chiamate esterne;
- `/health/ready`: puo ricevere traffico, con dipendenze necessarie disponibili;
- `/health/startup`: inizializzazione completata;
- `/metrics`: metriche Prometheus senza dati personali.

Il gateway rimuove dal routing un'istanza non ready. Il circuit breaker per provider esterni ha stati closed/open/half-open, timeout e cooldown. Un provider aperto non consuma thread HTTP e i job vengono differiti.

## 7. Logging e tracing end-to-end

Ogni richiesta e job porta questi campi strutturati:

- `timestamp` UTC ad alta precisione;
- `traceId`, `spanId`, `parentSpanId`, `requestId`;
- `service`, `version`, `environment`, `host`;
- `actorId` pseudonimizzato, `householdId` autorizzato e `route`;
- `eventId`, `jobId`, `queue`, `attempt`;
- `status`, `errorCode`, `durationMs`, `externalProvider`;
- `resourceUsage` aggregato quando disponibile.

OpenTelemetry crea span per gateway, API, query PostgreSQL, Redis, publish/consume, provider esterno e storage. Gli header W3C Trace Context attraversano HTTP e messaggi. Il payload alimentare, token, foto e dati sensibili non finiscono nei log: si registra un riferimento hashato o un identificativo tecnico.

Livelli: `INFO` per operazioni normali, `WARN` per retry/degrado, `ERROR` per fallimenti che richiedono intervento, `DEBUG` solo temporaneamente e con redazione. Log, metriche e trace hanno retention e accesso separati; audit di sicurezza e log applicativi non sono la stessa cosa.

## 8. Monitoring e alerting

### Stack di riferimento

La scelta standard e **OpenTelemetry Collector + Prometheus + Grafana + Alertmanager + Loki + Tempo**. Questa combinazione separa raccolta, storage, visualizzazione, alerting, log e tracing e puo essere ridotta nel profilo domestico senza cambiare l'instrumentation applicativa.

- OpenTelemetry Collector riceve i segnali dai servizi, applica batch, sampling, retry e redazione, poi li inoltra ai backend;
- Prometheus conserva metriche e valuta le regole di alert;
- Grafana fornisce dashboard, correlazione e drill-down;
- Alertmanager gestisce deduplicazione, grouping, silenziamento, routing ed escalation;
- Loki conserva log strutturati a basso costo rispetto a un indice full-text tradizionale;
- Tempo conserva trace distribuite e permette di passare da una metrica a una richiesta concreta.

Grafana non e il punto unico di affidabilita degli alert: Prometheus e Alertmanager continuano a valutare e inoltrare gli alert anche se Grafana e temporaneamente indisponibile. Le dashboard e le regole sono provisioning-as-code e vengono versionate insieme all'infrastruttura.

### Metriche globali

- disponibilita e latenza p50/p95/p99 per route;
- error rate per servizio, endpoint, capability e provider;
- saturazione CPU, RAM, disco, inode e temperatura host;
- spazio database, WAL, lock, query lente e connessioni;
- Redis memory, evictions, lag e persistence errors;
- queue depth, oldest job age, throughput, retry rate, DLQ size;
- restart, OOMKill, readiness failure e crash loop;
- backup age, ultimo backup riuscito e ultimo restore verificato.

### Alert iniziali

- P1: PostgreSQL non disponibile, perdita dati sospetta, storage quasi pieno, backup oltre RPO, API core indisponibile;
- P2: error rate core sopra soglia, p95 degradato, backlog oltre SLA, DLQ crescente, worker in crash loop;
- P3: provider esterno degradato, retry elevati, confidence OCR bassa, cache miss anomali, disco in crescita.

Gli alert hanno soglia, finestra, severita, owner, runbook e link a dashboard/traccia. Si usa `for`/debouncing per evitare flapping. Alert fatigue e un difetto operativo: nessun alert senza azione associata.

### Dashboard

1. **Overview**: salute utente, SLO, error budget e stato capability.
2. **Core**: API, gateway, PostgreSQL, Redis, risorse host.
3. **Queues**: profondita, eta job, retry, DLQ e consumer lag.
4. **Trace explorer**: una chiamata completa e i suoi span/bottleneck.
5. **Data protection**: backup, replica, restore drill e integrita.
6. **Business quality**: suggerimenti confermati, mismatch catalogo, ricette fallite e offerte stale.

### Regole di correlazione

Un alert deve portare a una dashboard e a un runbook. Una dashboard deve permettere di filtrare per `environment`, `service`, `version`, `route`, `queue`, `provider` e `traceId`. Un trace deve mostrare span del gateway, API, query, publish/consume, retry e provider. Questa catena consente di distinguere rapidamente errore applicativo, saturazione del server, backlog, dipendenza lenta e problema di dati.

## 9. Security monitoring

Audit append-only per login, cambio ruolo, inviti, accessi negati, export/cancellazione dati, upload, replay DLQ e azioni operative. Alert su molti accessi negati, uso anomalo di capability, escalation ruoli, replay massivi, export inconsueti e modifiche alla configurazione.

I log di sicurezza devono essere inviati a una destinazione separata o resa append-only; chi amministra l'app non deve poter cancellare silenziosamente le evidenze.

## 10. Readiness review prima della produzione

- test di perdita e restore PostgreSQL;
- test di riavvio di ogni worker durante un job;
- test di duplicazione evento e poison message;
- test provider lento, 429, 500 e schema inatteso;
- test esaurimento disco e memoria;
- test di spegnimento/riattivazione capability;
- verifica dashboard, alert e runbook;
- verifica che il traceId segua una chiamata fino a DB, coda e provider;
- verifica dei limiti privacy nei log;
- chaos test controllato su ambiente non produttivo.
