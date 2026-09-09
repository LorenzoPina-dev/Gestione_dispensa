# Runbook operativi P0

## 1. Regole comuni di incidente

1. dichiarare severita e incident commander;
2. aprire timeline con UTC, trace e azioni;
3. contenere senza cancellare evidenze;
4. proteggere dati e credenziali;
5. comunicare stato e impatto;
6. ripristinare prima il core, poi capability opzionali;
7. verificare integrita e metriche;
8. chiudere con postmortem e azioni assegnate.

Non eseguire comandi distruttivi in produzione senza approval e backup verificato.

## 2. PostgreSQL indisponibile

**Sintomi**: API 503, readiness false, connection errors, alert P1.

**Azioni**:

- verificare spazio disco, processo, volume, connessioni e lock;
- bloccare worker non essenziali per ridurre pressione;
- mantenere UI in read-only/offline con ultimo stato dichiarato;
- non accettare mutazioni se non possono essere persistite;
- ripristinare istanza o failover previsto;
- verificare migration/schema e integrita;
- riavviare API e `worker-core` gradualmente;
- eseguire reconciliation outbox/inventory;
- confermare nessun movimento perso.

**Evidenze**: traceId, log DB, WAL position, backup age, reconciliation report.

## 3. Redis perso o degradato

**Impatto atteso**: cache e queue operative indisponibili; dati autorevoli intatti.

**Azioni**:

- dichiarare capability async degraded;
- impedire nuove operazioni che richiedono queue se non persistibili;
- ripristinare Redis/AOF o creare istanza pulita;
- ricostruire cache da PostgreSQL;
- ripubblicare outbox non acknowledged;
- deduplicare tramite inbox/eventId;
- controllare DLQ e queue age;
- riattivare worker core prima degli optional.

Non trattare la perdita Redis come perdita inventario.

## 4. Outbox backlog o publisher fermo

**Sintomi**: `outbox_pending` crescente, eventi non pubblicati, projection lag.

**Azioni**:

- controllare lock, errori broker, schema validation e permessi;
- limitare nuove capability pesanti;
- riavviare un publisher con batch bounded;
- rispettare backoff e non duplicare manualmente senza eventId;
- verificare publish ack e stato outbox;
- eseguire reconciliation dopo svuotamento.

**Alert**: oldest outbox age, publish error rate, batch duration.

## 5. Queue backlog/DLQ

**Azioni**:

- distinguere backlog lento da poison message;
- proteggere `worker-core` con quota risorse;
- ridurre concurrency se provider rate-limita;
- isolare poison in DLQ;
- correggere schema/provider prima del replay;
- replayare una finestra piccola con nuova execution id;
- verificare idempotenza e risultati;
- documentare messaggi scartati secondo retention.

Mai svuotare una DLQ senza esportare metadati e approvazione.

## 6. Backup fallito o restore fallito

**Azioni**:

- verificare age, checksum, spazio e credenziali;
- non dichiarare RPO rispettato;
- creare snapshot alternativo se il DB e sano;
- testare backup precedente noto buono in ambiente isolato;
- confrontare conteggi di famiglie, membership, movimenti e outbox;
- correggere pipeline e ripetere drill;
- bloccare release distruttive finche il budget recovery non e ripristinato.

## 7. Token QR compromesso/abuso

**Azioni**:

- revocare invito e tutti i token correlati;
- controllare scansioni, IP aggregati, rate limit e membership create;
- non registrare o diffondere il token raw;
- rimuovere membership non autorizzate secondo procedura auditata;
- ruotare secret solo se il problema non e limitato all'invito;
- informare creator e interessati;
- aggiungere detection rule e postmortem.

## 8. Provider OCR/AI/retailer indisponibile

**Azioni**:

- aprire circuit breaker;
- mantenere inserimento manuale e core disponibili;
- lasciare job in `RETRY_WAIT` o `DEGRADED`;
- rispettare Retry-After e budget;
- non mostrare offerte stale come attive;
- attivare fallback autorizzato solo se configurato;
- chiudere breaker in half-open con probe limitati;
- misurare costo e backlog dopo recovery.

## 9. Disco pieno/OOM

**Azioni**:

- P1 se coinvolge PostgreSQL o backup; P2 per capability non core;
- fermare ingestion non essenziale e retention jobs controllati;
- non cancellare audit o database manualmente;
- identificare log, trace, WAL, media o immagini responsabili;
- applicare lifecycle policy e aumentare storage;
- controllare integrita DB dopo spazio recuperato;
- verificare OOMKill e ridurre concurrency/resource limits.

## 10. Migrazione fallita

**Azioni**:

- fermare rollout e preservare versione/schema;
- non fare rollback cieco se dati parzialmente trasformati;
- leggere migration state e lock;
- ripristinare compatibilita precedente o forward-fix controllato;
- usare backup solo dopo valutazione perdita/delta;
- validare constraint, conteggi e query core;
- riavviare una replica/istanza alla volta;
- registrare ADR/postmortem.

## 11. Data quality incidente

**Esempi**: quantità negativa, allergene errato, offerta stale, duplicati catalogo.

**Azioni**:

- bloccare propagazione della fonte/proiezione difettosa;
- conservare dati originali e provenance;
- correggere tramite comando/versione, mai update silenzioso del ledger;
- invalidare cache e proiezioni coinvolte;
- notificare utenti se una raccomandazione era rischiosa;
- aggiungere test di regressione e quality alert.

## 12. Chiusura incidente

- health/readiness verdi;
- error rate e queue age rientrati;
- backup/recovery verificati;
- audit e timeline completi;
- dati e proiezioni riconciliati;
- owner remediation e scadenza;
- comunicazione finale e postmortem.
## Backup and restore automation

Backup artifacts are referenced by an encrypted manifest and never include connection strings,
tokens, or personal data in logs. Verification updates the manifest only after both PostgreSQL and
MinIO artifact references are present. Restore drills must use an isolated `restore-<backupId>`
target; production paths are rejected by the backup helper.
