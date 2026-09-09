# Product brief e metriche di successo

## 1. Problema

Le famiglie dimenticano cosa possiedono, acquistano duplicati, lasciano scadere alimenti e costruiscono la lista della spesa manualmente. Le catene retail hanno inoltre bisogno di dati operativi e suggerimenti pertinenti senza compromettere privacy, consistenza o affidabilita.

## 2. Visione

Una dispensa condivisa, semplice e verificabile che riduce sprechi e lavoro mentale: registra cio che entra, rende evidente cio che resta, suggerisce cio che manca e propone azioni utili senza automazioni irreversibili.

## 3. Utenti e bisogni

| Persona | Bisogno principale | Successo |
|---|---|---|
| Creator famiglia | creare nucleo e invitare membri rapidamente | famiglia attiva in pochi minuti |
| Membro famiglia | registrare acquisto/consumo con minimo attrito | operazione completata senza capire il modello dati |
| Responsabile spesa | lista affidabile e condivisa | nessun duplicato e meno dimenticanze |
| Utente attento a scadenze | usare prima cio che scade | spreco ridotto e notifiche utili |
| Utente nutrizione | conoscere calorie e qualita dei dati | valori con fonte e distinzione stima/dato |
| Retailer | gestire catalogo/offerte e scala tenant | isolamento, audit e integrazioni verificabili |

## 4. MVP e fuori perimetro

### MVP MUST: family-local

- autenticazione e famiglia;
- invito QR sicuro;
- catalogo manuale e barcode;
- scorte, lotti, scadenze e movimenti;
- soglie e lista della spesa condivisa;
- ricerca e dashboard;
- audit, backup, osservabilita e recovery documentato.

Il MVP deve essere avviabile localmente tramite Docker Compose senza dipendenze cloud obbligatorie. Grafana, Prometheus, Alertmanager, Loki, Tempo, PostgreSQL, Redis, MinIO, Keycloak e OpenTelemetry appartengono al profilo locale.

### Dopo MVP

Foto/OCR, import scontrini, ricette, nutrizione avanzata, offerte, notifiche avanzate, offline limitato e personalizzazione opt-in.

### Fuori perimetro iniziale

Acquisto automatico, diagnosi/prescrizioni, profilazione pubblicitaria implicita, alta disponibilita su singolo host, fonti retailer non autorizzate.

## 5. Metriche prodotto

| Metrica | Definizione | Target iniziale | Fonte |
|---|---|---:|---|
| activation rate | utenti che completano onboarding e prima scorta / nuovi utenti | >= 60% | eventi prodotto aggregati |
| time to first stock | tempo da account a prima scorta | p50 < 5 min | journey telemetry |
| stock accuracy | scorte confermate senza correzione / scorte registrate | >= 90% | inventory corrections |
| batch entry completion | sessioni batch concluse / iniziate | >= 80% | UI events |
| reorder acceptance | suggerimenti lista accettati / mostrati | >= 50% | shopping events |
| duplicate rate | prodotti duplicati confermati / inserimenti | <= 5% | catalog events |
| expiry action rate | scadenze con azione / scadenze notificate | >= 60% | expiry events |
| recipe usefulness | ricette salvate/cucinate / aperte | target da baseline | recipe events |
| notification opt-out | opt-out entro 30 giorni | monitorare, non ottimizzare a scapito del consenso | consent events |
| support recovery | errori recuperati senza supporto | >= 80% | error/recovery events |

I target sono ipotesi da validare con utenti reali. Non usare identificatori personali o payload alimentari per analytics prodotto.

## 6. Metriche enterprise

- tenant isolation test pass rate: 100%;
- catalog import success e reconciliation rate;
- offer freshness SLA per retailer;
- cost per active household/tenant;
- API SLO e job SLO per capability;
- quota rejection e provider cost;
- audit completeness;
- restore success rate;
- change failure rate e mean time to recovery.

## 7. Principi di prodotto

- il sistema suggerisce, l'utente conferma quando l'azione e ambigua o irreversibile;
- dati incerti hanno fonte, qualita e timestamp;
- il core funziona con capability opzionali spente;
- ogni automazione ha undo, audit e stato;
- la privacy e parte dell'esperienza, non un'impostazione nascosta;
- ogni metrica ha una finalita e una retention dichiarate.
