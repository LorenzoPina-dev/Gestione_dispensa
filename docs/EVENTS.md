# Eventi e job asincroni

Questa pagina descrive il trasporto e le regole di compatibilità; non implica che ogni evento elencato o ogni consumer possibile sia attivo. Il deployment e i consumer realmente avviati sono in [SERVICES.md](SERVICES.md). I flussi funzionali sono in [DIAGRAMS.md](DIAGRAMS.md#dispensa-movimenti-ed-eventi).

## Trasporto presente nel Compose

Gli eventi di dominio seguono il percorso:

`transazione del servizio owner → outbox PostgreSQL → relay dedicato → Redis Stream events:domain → consumer group`.

Il relay usa `FOR UPDATE SKIP LOCKED`, pubblica un envelope e marca la riga outbox pubblicata. Se il processo termina tra pubblicazione e commit, un messaggio può essere pubblicato di nuovo: i consumer devono deduplicare tramite `eventId`/tabella consumer prima di applicare l'effetto. La consegna è quindi trattata come at-least-once.

Redis contiene anche code per job applicativi, distinte dallo stream di eventi. Jobs conserva job, tentativi e dead letters in PostgreSQL. Il Compose corrente non usa Kafka.

## Envelope relay

Il relay costruisce un messaggio con questi campi, derivati dalla riga outbox:

```json
{
  "eventId": "uuid",
  "eventType": "nome stabile definito dal producer",
  "schemaVersion": 1,
  "occurredAt": "2026-10-09T10:00:00Z",
  "producer": "service-owner",
  "aggregateId": "uuid",
  "familyId": "uuid oppure null",
  "correlationId": "uuid",
  "causationId": null,
  "payload": {}
}
```

I campi sono una descrizione del relay corrente, non un sostituto del tipo condiviso/schema usato dal singolo producer. In particolare il relay attuale invia `causationId: null`; non presumere che la causazione sia sempre valorizzata.

## Atomicità e ownership

Quando un servizio pubblica un evento, la modifica di dominio e l'inserimento nella sua tabella outbox devono avvenire nella stessa transazione. Il consumer scrive solo nel proprio database o chiama l'API owner del dato; non aggiorna direttamente le tabelle di un altro dominio.

Per ogni consumer:

1. valida il messaggio e la versione supportata;
2. controlla se `eventId` è già stato processato;
3. applica la modifica nel proprio dominio e registra la deduplica nella stessa transazione;
4. conferma il messaggio dopo il commit;
5. tratta retry e messaggi ripetuti senza duplicare gli effetti.

Le tabelle `event_consumers` e `processed_events` sono usate dai domini che le hanno migrate; non tutti i servizi hanno la stessa implementazione interna.

## Job applicativi

I job sono un meccanismo distinto dagli eventi di dominio:

- `service-jobs` espone amministrazione e replay protetti;
- `jobs_db` conserva job, tentativi, dead letters, inbox e audit;
- Redis offre code a bassa latenza per i worker configurati;
- il producer scrive i job persistenti e inoltra il messaggio secondo l'adapter disponibile;
- capability senza consumer non completano il workflow solo perché il job è stato accodato.

OCR usa la coda `q:ocr-processing` e `worker-ocr`. Gli altri worker/code attivi si verificano in `docker-compose.yml` e nei rispettivi entrypoint.

## Vocabolario e compatibilità

Il nome concreto dell'evento è definito dal producer e dai contratti condivisi. In questo repository coesistono contratti versionati e implementazioni in evoluzione: gli esempi storici nelle sezioni di vocabolario non sono prova che un evento venga emesso o consumato nel deployment.

Prima di aggiungere/modificare un evento verificare insieme:

- costante/schema del producer;
- inserimento effettivo nell'outbox;
- configurazione del relay;
- consumer group, handler e deduplica;
- migration del database consumer;
- test del contratto.

Le modifiche incompatibili richiedono una nuova versione del payload o un nuovo event type e un periodo di compatibilità esplicito. Non includere token, password, codici invito raw, stack trace o credenziali nel payload.

## Consumer runtime indicati dal Compose

- `worker-shelf-life`: consumer di eventi di dispensa e stime shelf-life.
- `worker-shopping`: proiezioni/suggerimenti riordino derivati dagli eventi.
- `worker-notifications`: preferenze, deduplica e gestione degli eventi notifica.
- `worker-ocr`: consumer della coda job OCR, non dello stream generale.

La presenza di un evento nella documentazione o di una migration consumer non garantisce da sola che ogni capability sia completa end-to-end. Per esempio, una richiesta privacy accodata non è prova che il processo di cancellazione/esportazione su tutti i domini sia stato eseguito.
