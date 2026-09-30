# Diagnosi errori e tracciabilita

Come risalire alla provenienza di un errore e riprodurlo. Implementa [ADR-0002](ADR-0002-observability-stack.md).

## Modello di correlazione

Ogni richiesta ha due identificatori che la seguono ovunque:

| Campo | Origine | Dove compare |
|---|---|---|
| `requestId` | generato dal browser (`X-Request-Id`), o da nginx se manca | log nginx, log di ogni servizio, header di risposta `x-request-id`, `meta.requestId` nelle risposte d'errore |
| `traceId` | generato dal browser (`traceparent`, W3C), o da nginx se manca | come sopra + span in Tempo |

Percorso: `browser -> nginx -> gateway -> service-* -> Postgres / altri servizi / provider esterni`.
Il gateway e i servizi propagano `traceparent` e `x-request-id` sulle chiamate in uscita (fetch strumentata in
`packages/observability/src/service-runtime.ts`); gli host esterni ricevono solo la richiesta, senza header di traccia.

Ogni richiesta produce **una riga di log** `http.request` per hop, con: `service`, `method`, `route`, `status`, `durationMs`,
`userId`, `familyId`, `upstream` (chi ha fallito), `errorCode`, `errorMessage` e `err` (nome, SQLSTATE, causa, stack per i 5xx).
Per i 5xx sono inclusi anche `requestQuery` e `requestBody` **gia' redatti** (token, password, email, ecc. sostituiti da `[REDACTED]`):
bastano per rieseguire la chiamata su uno stack di sviluppo.

## Procedura: "un utente ha visto un errore"

1. **Ottieni l'id.** Dal report del browser (`web.client_error`, campi `webRequestId` / `webTraceId`), dal campo
   `meta.requestId` della risposta d'errore, o dall'header `x-request-id` nel DevTools.
2. **Grafana -> dashboard "Dispensa - Errors & Traceability"** -> incolla l'id nel box `requestId / traceId`.
   Il pannello *Request explorer* mostra tutte le righe di tutti i servizi, in ordine temporale.
3. **Chi ha fallito?** Cerca la prima riga con `level=error`/`warn`. Il campo `upstream` sul gateway indica il servizio a valle;
   `errorCode` e `err` (con `sqlstate` per il DB) danno la causa.
4. **Vedi la traccia.** Su una riga di log clicca il link *Open trace in Tempo* (derived field su `traceId`): la timeline mostra
   dove e' stato speso il tempo e quale span e' andato in errore. Da uno span il link verso Loki riporta ai log di quel trace.
5. **Riproduci.** Per un 5xx copia `route`, `requestQuery` e `requestBody` dalla riga `http.request` e riesegui sullo stack locale.
   Se l'errore e' una query lenta/fallita, `db.query_failed` / `db.slow_query` riportano operazione, SQLSTATE e testo SQL (mai i parametri).

Errore visto dall'utente ma **nessuna riga** nei servizi? La richiesta non ha raggiunto il gateway: guarda l'access log di nginx
(`service="nginx"`, stesso `requestId`, `upstreamStatus`) e il report `web.client_error` con `kind="network_error"`.

Query utili in Loki (Explore):

```logql
{service="gateway"} | json | level="error"
{service=~".+"} | json | requestId="<id>"
{service="gateway"} | json | event="http.request" | status >= 500
{service=~".+"} | json | event="db.query_failed"
```

## Cosa NON finisce nei log

Token, password, cookie, `Authorization`, email, telefono, immagini, prompt (chiavi redatte per nome), stringhe con
`Bearer ...`, `password=...`, `postgres://user:pw@...` (scrub sul testo libero), parametri SQL, il campo `detail` di pg
(puo' contenere valori di riga), query string negli access log nginx. Etichette Prometheus/Loki: mai `userId`, `traceId`,
`requestId` come label (solo `service` e `level` in Loki; gli id sono *structured metadata*).

## Avvio locale

```powershell
npm run obs:sync                     # crea/aggiorna src/observability.ts in ogni servizio (una tantum e dopo ogni modifica del runtime)
# in .env: OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318   (abilita le tracce)
docker compose --profile observability-full up -d --build
```

Grafana http://localhost:3001 - Prometheus http://localhost:9090 - Alertmanager http://localhost:9093.
Verifica regole: `docker run --rm -v ${PWD}/infra/observability/prometheus:/p --entrypoint promtool prom/prometheus:v2.53.4 check rules /p/rules/core.yml`.

## Collegare un servizio (checklist, riferimento: `services/service-inventory`)

1. Aggiungi il servizio a `OBSERVED_SERVICES` in `tools/sync-observability.mjs` (gia' presenti i servizi HTTP) e lancia `npm run obs:sync`.
2. `server.ts`: `startObservability("<nome>")` prima di tutto; `requestObservability()` come **primo** middleware;
   `rebindContext()` subito dopo `express.json()`; `GET /metrics` -> `metricsHandler`; `errorMiddleware()` per ultimo, prima di `listen`.
3. `http/middleware.ts`: rimuovi i `console.log/error`; in `resolvePrincipal` chiama `annotate({ userId })` e `log.warn("auth.token_verification_failed", {}, error)`.
4. `http/envelope.ts`: non sovrascrivere il `traceparent` gia' impostato; in `respond()` chiama `recordError(error, { status })` prima di rispondere.
5. `db/postgres-client.ts`: avvolgi `client.query(...)` con `traceDb(text, () => ...)`, `registerPool(...)`, `pool.on("error", ...)`.
6. `/health/ready`: controlla il **valore** di `pg.ping()` (restituisce `false`, non lancia: un `try/catch` da solo non basta).
7. `infra/observability/prometheus/prometheus.yml`: porta l'etichetta `instrumented` del servizio a `"true"`.
8. `npm run obs:check` deve passare (e' in CI).

## Runbook degli alert

### Alert: ServiceDown
`/metrics` non risponde da 2 minuti. `docker compose ps`, poi `{service="<nome>"} | json | level="error"` e `event="process.fatal"`.
Cause tipiche: crash all'avvio (variabili mancanti, DB non raggiungibile), OOM (vedi memoria RSS in dashboard).

### Alert: ServiceRestarted
Il processo e' ripartito (reset del contatore CPU). Cerca `process.fatal` subito prima del riavvio: contiene tipo
(`uncaughtException` / `unhandledRejection`) e stack.

### Alert: HighServerErrorRate
Oltre il 5% di 5xx. Dashboard: *5xx by service and route* per il punto, *Errors by domain error code* per il motivo,
poi Request explorer su un `requestId` di esempio.

### Alert: HighLatencyP95
p95 > 1,5 s. Confronta *Database query p95*, *Outbound p95 by target* e *Event loop lag*: dicono se il tempo va in DB,
in un servizio a valle o in CPU locale. Per un caso concreto apri il trace in Tempo.

### Alert: UpstreamCallsFailing
Chiamate in uscita in errore/timeout verso `target`. Se il target e' un servizio interno controlla il suo `ServiceDown`;
se e' un provider esterno (es. Open Food Facts) e' un problema di terzi: il sistema deve degradare, non fallire.

### Alert: WebClientErrorsSpike
Il browser segnala molti errori. `{service="gateway"} | json | event="web.client_error"` raggruppa per `kind`, `page`, `appVersion`.
Un picco dopo un rilascio punta alla nuova versione.

### Alert: DatabaseErrors
Errori PostgreSQL non di integrita' (classe SQLSTATE 23 esclusa). `57014` = `statement_timeout` (5 s), `40001/40P01` = serializzazione/deadlock,
`08xxx` = connessione, `42xxx` = errore SQL/schema (spesso una migrazione mancante).

### Alert: DatabasePoolSaturated
Richieste in attesa di una connessione (`db_pool_connections{state="waiting"} > 0`). Cerca `db.slow_query` e transazioni lunghe;
alzare `max` del pool va fatto solo dopo aver escluso query lente o connessioni non rilasciate.

### Alert: EventLoopLag
Event loop bloccato (p99 > 200 ms): lavoro CPU sincrono o GC pesante. Correla con memoria e con le richieste lente.

### Alert: TracesBeingDropped
Il collector non e' raggiungibile o il buffer e' pieno: le tracce sono incomplete, il dominio non e' impattato.
Verifica `OTEL_EXPORTER_OTLP_ENDPOINT` e che il profilo `observability-full` sia attivo.
