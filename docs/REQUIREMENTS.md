# Requisiti di prodotto e di sistema

## 1. Scopo del documento

Questo documento traduce la visione in requisiti verificabili per product owner, architetti, sviluppatori, QA, operations e privacy. Ogni requisito ha un identificativo stabile. Una implementazione non e completa finche non esistono test o evidenze che dimostrano i requisiti applicabili.

Priorita:

- **MUST**: necessario per una release utilizzabile e sicura;
- **SHOULD**: importante, puo seguire il primo rilascio;
- **COULD**: valore aggiuntivo;
- **WONT**: esplicitamente fuori dal perimetro corrente.

## 2. Attori e contesti

- **Owner household**: crea il nucleo, gestisce membri, consensi e impostazioni.
- **Manager household**: gestisce prodotti, scorte, soglie e liste.
- **Member**: registra consumi e visualizza/prepara liste secondo permessi.
- **Viewer**: sola lettura.
- **Platform operator**: monitora runtime e gestisce incidenti; non legge dati alimentari salvo procedura autorizzata.
- **Catalog operator**: corregge dati canonici e fonti.
- **Retailer/data provider**: fonte esterna non fidata, con contratto e limiti propri.

## 3. Requisiti funzionali

### Identita e household

- **FR-001 MUST**: l'utente deve poter autenticarsi tramite OIDC Authorization Code + PKCE.
- **FR-002 MUST**: ogni risorsa utente deve appartenere a una famiglia (`family/household`) e ogni accesso deve verificarne la membership attiva e la famiglia corrente.
- **FR-003 MUST**: owner e manager devono poter invitare, sospendere e rimuovere membri secondo policy.
- **FR-004 MUST**: ogni operazione mutante deve registrare actor, household, timestamp e correlation id.
- **FR-005 MUST**: l'utente deve poter esportare e richiedere cancellazione dei propri dati.
- **FR-006 MUST**: il creatore deve poter creare una famiglia e diventare automaticamente `CREATOR`.
- **FR-007 MUST**: il creatore o un admin autorizzato deve poter generare un invito QR temporaneo, monouso, revocabile e associato a un ruolo.
- **FR-008 MUST**: la scansione QR deve portare a un flusso di review e conferma; la scansione da sola non deve concedere accesso.
- **FR-009 MUST**: un utente non autenticato deve poter completare OIDC e tornare al flusso join tramite redirect interno sicuro.
- **FR-010 MUST**: l'accettazione dell'invito deve creare una sola membership, consumare il token e pubblicare audit/outbox in modo atomico e idempotente.
- **FR-011 MUST**: il sistema deve supportare QR scaduto, revocato, gia usato, alterato e codice fallback rate-limited con messaggi di recupero.
- **FR-012 MUST**: un utente puo appartenere a piu famiglie e deve poter cambiare famiglia attiva senza leakage della cache o delle query.

### Catalogo e identificazione

- **FR-013 MUST**: il sistema deve accettare creazione manuale di un prodotto.
- **FR-014 MUST**: il client deve poter inviare un barcode normalizzato.
- **FR-015 MUST**: barcode, alias, brand, formato e unita devono essere associabili a un prodotto canonico.
- **FR-016 MUST**: una fonte esterna deve conservare provenienza, timestamp, versione e confidence per ogni dato importato.
- **FR-017 MUST**: OCR/vision deve produrre candidati, mai modifiche confermate senza revisione quando la confidence e sotto soglia.
- **FR-018 MUST**: il sistema deve gestire conflitti tra dato esterno e modifica manuale senza sovrascrittura silenziosa.

### Inventario e consumo

- **FR-020 MUST**: ogni entrata, consumo, spreco, rettifica e trasferimento deve essere un movimento immutabile.
- **FR-021 MUST**: le quantita devono usare numeric con unita esplicita e impedire risultati negativi non autorizzati.
- **FR-022 MUST**: devono essere supportati lotti, scadenza, posizione, formato e soglia di riordino.
- **FR-023 MUST**: il sistema deve calcolare la quantita disponibile come proiezione ricostruibile dei movimenti.
- **FR-024 MUST**: movimenti duplicati ritrasmessi dal client devono essere idempotenti.
- **FR-025 SHOULD**: il consumo puo essere stimato da ricette/diario, ma deve essere marcato come stimato e correggibile.

### Lista della spesa

- **FR-030 MUST**: al raggiungimento della soglia il sistema deve produrre un suggerimento idempotente.
- **FR-031 MUST**: righe equivalenti devono essere aggregate secondo prodotto canonico, unita e confezione.
- **FR-032 MUST**: l'utente deve poter accettare, modificare, rimandare, ignorare e completare ogni riga.
- **FR-033 MUST**: una lista deve poter essere condivisa con i membri autorizzati del household.
- **FR-034 SHOULD**: la lista deve poter ordinare righe per negozio, reparto, urgenza e offerta.

### Ricerca e analisi

- **FR-040 MUST**: la ricerca deve supportare testo, barcode, categoria, brand, disponibilita, scadenza e posizione.
- **FR-041 MUST**: i risultati devono mostrare quantita, unita, soglia, lotto e data di aggiornamento.
- **FR-042 SHOULD**: la ricerca avanzata deve usare una proiezione ricostruibile, senza diventare fonte autorevole.
- **FR-043 MUST**: tutte le query devono rispettare household isolation e permessi.

### Ricette e nutrizione

- **FR-050 SHOULD**: il sistema deve proporre ricette usando disponibilita, scadenze vicine, preferenze e allergeni esclusi.
- **FR-051 MUST**: ogni proposta deve mostrare ingredienti disponibili, mancanti, sostituzioni e fonte.
- **FR-052 MUST**: dati nutrizionali e allergeni devono avere fonte e qualita dichiarate.
- **FR-053 MUST**: l'AI non deve presentare stime come valori verificati e deve applicare filtri di sicurezza.
- **FR-054 SHOULD**: calorie e macro devono essere calcolati per porzione e consumo confermato, separando stima e dato registrato.

### Offerte e retailer

- **FR-060 SHOULD**: il sistema deve importare offerte solo da fonti autorizzate o contrattualmente ammesse.
- **FR-061 MUST**: ogni offerta deve indicare fonte, negozio/area, periodo di validita, condizioni e ultimo aggiornamento.
- **FR-062 MUST**: offerte stale o non verificabili non devono essere mostrate come attive.
- **FR-063 SHOULD**: la lista deve poter suggerire una fonte alternativa, senza modificare automaticamente la lista accettata.

### Asincronia e capability

- **FR-070 MUST**: ogni lavoro lento deve restituire `jobId` e stato consultabile.
- **FR-071 MUST**: i worker devono usare code separate, retry, idempotenza, backpressure e DLQ.
- **FR-072 MUST**: una capability opzionale indisponibile deve degradare in `PENDING`, `DEGRADED` o `UNAVAILABLE`, senza bloccare il core.
- **FR-073 MUST**: ogni job deve conservare tentativi, errore classificato, durata e risultato.
- **FR-074 SHOULD**: operatori autorizzati devono poter ispezionare e riprodurre un job DLQ con audit.

### Esperienza utente e assistenza al percorso

- **FR-080 MUST**: il primo avvio deve guidare l'utente da account/household a prima scorta con possibilità di saltare le impostazioni opzionali.
- **FR-081 MUST**: l'utente deve poter aggiungere prodotti manualmente, tramite barcode, tramite foto e tramite import, con un percorso di recupero se il metodo scelto fallisce.
- **FR-082 MUST**: il sistema deve supportare inserimento batch e azioni rapide per acquisto, consumo, spreco, annullamento e correzione.
- **FR-083 MUST**: la dashboard deve mostrare scorte basse, scadenze, lista attiva e azioni prioritarie senza richiedere comprensione dei dettagli tecnici.
- **FR-084 MUST**: la lista della spesa deve permettere accettazione/rifiuto batch, modifica quantita, raggruppamento, condivisione, completamento e archiviazione.
- **FR-085 MUST**: il completamento di una lista deve offrire il caricamento delle righe identificate nella dispensa, con conferma della quantita realmente acquistata.
- **FR-086 MUST**: consumo totale/parziale, spreco, rettifica e conflitto multiutente devono essere azioni esplicite e reversibili dove possibile.
- **FR-087 MUST**: ogni stato offline, errore, duplicato, conflitto, job pendente e capability degradata deve mostrare conseguenza e azione di recupero.
- **FR-088 MUST**: le notifiche devono essere configurabili per categoria, canale, priorita, quiet hours e consenso.
- **FR-089 SHOULD**: l'utente deve poter configurare posizione, scadenza, soglie, unita, preferenze alimentari, retailer e budget senza passare dal supporto.
- **FR-090 SHOULD**: la PWA deve supportare operazioni offline limitate con sincronizzazione, conflitti espliciti e nessuna perdita silenziosa.
- **FR-091 MUST**: suggerimenti, offerte e personalizzazione devono mostrare motivo, fonte/qualita e stato di consenso; non possono modificare dati senza conferma.
- **FR-092 MUST**: i flussi core devono essere utilizzabili da tastiera, screen reader, touch e viewport mobile secondo WCAG 2.2 AA.
- **FR-093 MUST**: lingua, locale, formato numerico, unita e timezone devono essere coerenti con il household.

## 4. Requisiti non funzionali

- **NFR-001 Sicurezza MUST**: deny-by-default, OIDC, RBAC/ABAC, CSRF, CSP, rate limit, secret management, scanning e audit.
- **NFR-002 Isolamento MUST**: nessuna query o evento puo attraversare household senza policy verificata.
- **NFR-003 Affidabilita MUST**: delivery almeno una volta, handler idempotenti, outbox transazionale e recovery documentato.
- **NFR-004 Prestazioni SHOULD**: letture p95 sotto 400 ms e comandi inventario p95 sotto 600 ms in condizioni di riferimento.
- **NFR-005 Scalabilita MUST**: API e worker devono essere stateless o ricostruibili e scalabili orizzontalmente in Kubernetes.
- **NFR-006 Osservabilita MUST**: ogni richiesta e job deve avere log, metriche e trace correlabili.
- **NFR-007 Privacy MUST**: minimizzazione, retention, export, cancellazione, consenso e divieto di loggare dati sensibili.
- **NFR-008 Accessibilita SHOULD**: interfaccia conforme almeno a WCAG 2.2 AA per flussi core.
- **NFR-009 Compatibilita SHOULD**: API versionate e migrazioni backward-compatible.
- **NFR-010 Operabilita MUST**: health/readiness, backup, restore drill, runbook e alert con owner.
- **NFR-011 Usabilita MUST**: i flussi core devono avere percorso rapido, stato esplicito, recovery e undo/correzione documentati.
- **NFR-012 Accessibilita MUST**: nessuna informazione critica deve dipendere solo da colore, hover o timeout breve.
- **NFR-013 Offline SHOULD**: il comportamento senza rete deve essere dichiarato, limitato, idempotente e verificabile.
- **NFR-014 Localizzazione MUST**: date, numeri, unita, timezone e testi devono essere deterministici e localizzabili.
- **NFR-015 Performance UX SHOULD**: azioni locali e schermate core devono fornire feedback immediato, mentre i lavori lunghi usano stato asincrono senza bloccare la navigazione.
- **NFR-016 Privacy UX MUST**: consensi, profilazione, notifiche e uso provider devono essere comprensibili, separati e revocabili.

## 5. Requisiti di accettazione trasversali

Una feature e pronta solo quando:

1. ha un owner di dominio e un contratto documentato;
2. definisce autorizzazioni, errori, idempotenza e comportamento offline/degradato;
3. ha test unitari, integrazione e almeno un test del percorso principale;
4. emette telemetria senza dati sensibili;
5. ha migrazione e strategia di rollback se cambia dati;
6. aggiorna threat model, retention e documentazione utente quando necessario;
7. ha metriche e alert se il suo fallimento richiede intervento;
8. e verificabile con una checklist di acceptance indipendente dal framework.

## 6. Fuori perimetro esplicito

- acquisto automatico senza conferma;
- prescrizioni o diagnosi mediche;
- profilazione pubblicitaria senza consenso separato;
- riconoscimento fotografico garantito per ogni alimento;
- alta disponibilita su singolo host;
- uso di fonti retailer senza verifica di termini, licenza e copertura geografica.
