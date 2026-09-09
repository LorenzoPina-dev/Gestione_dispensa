# Decisioni, assunzioni e domande residue

## 1. Decisioni assunte per procedere senza blocchi

| ID | Decisione/default | Motivo | Reversibilita |
|---|---|---|---|
| D-001 | lingua iniziale italiana, locale `it-IT` | contesto utente e dominio | alta |
| D-002 | unita metriche come default | Italia/UE; supporto imperial come opzione | alta |
| D-003 | PWA responsive prima di app native | costo e superficie ridotti | alta |
| D-004 | family come termine UI; `householdId` migrato verso `familyId` nei nuovi contratti | chiarezza utente e coerenza dominio | media |
| D-005 | PostgreSQL fonte autorevole | invarianti, ledger, outbox e server domestico | media, ADR richiesta |
| D-006 | Redis solo cache/code/lock | nessun dato core dipende da Redis | alta |
| D-007 | QR invite default 10 minuti e monouso | sicurezza e semplicità | alta |
| D-008 | suggerimenti non modificano dati senza conferma | prevenzione errori | alta |
| D-009 | PostgreSQL search prima di OpenSearch | evitare costo operativo prematuro | alta |
| D-010 | AI/OCR/offerte disattivi in `home-small` | risorse, costo e privacy | alta |
| D-011 | profilo utente opt-in separato dal profilo tecnico | privacy e controllo utente | alta |
| D-012 | delivery at-least-once + idempotenza | comportamento realizzabile e resiliente | bassa |
| D-013 | dati e backup in regione UE quando il provider lo consente | minimizzazione trasferimenti | media |
| D-014 | timezone della famiglia per scadenze e notifiche | comportamento prevedibile tra membri | alta |
| D-015 | cancellazione ledger tramite anonimizzazione/tombstone, non update distruttivo | audit e consistenza | bassa |
| D-016 | primo rilascio `family-local` completamente eseguibile via Docker Compose | server domestico, privacy e riproducibilita | alta |
| D-017 | PostgreSQL, Redis, MinIO, Keycloak, OTel, Prometheus, Grafana, Alertmanager, Loki e Tempo sono container locali del profilo principale | nessuna dipendenza infrastrutturale cloud obbligatoria | alta |
| D-018 | core release: famiglia, QR, catalogo manuale/barcode, inventario, consumi, soglie, lista e audit | valore utile prima delle capability costose | media |
| D-019 | OCR, AI, offerte retailer e integrazioni esterne sono capability opzionali disattivabili | risorse e costi del server domestico | alta |

## 2. Domande che richiedono il proprietario del prodotto

Queste sono le sole domande bloccanti per congelare i contratti di release; in assenza di risposta valgono i default sopra.

1. Quali paesi e catene saranno nel perimetro futuro delle offerte?
2. Qual e il canale di alerting esterno preferito oltre ad Alertmanager/Grafana locale?
3. Quale retention desideri per foto, log, liste storiche e backup?
4. Le calorie sono solo informative o vuoi un diario nutrizionale completo?

## 3. Decisioni da non lasciare implicite

- licenza e termini delle fonti catalogo/offerte/ricette;
- base giuridica per dati nutrizionali e profilazione;
- soglia confidence che richiede revisione umana;
- limiti di famiglie per utente e membri per famiglia;
- nomenclatura definitiva `family`/`household` durante migrazione;
- SLA e supporto per il futuro retailer;
- residenza dati e subprocessor;
- policy per minori e account condivisi.

## 4. Regola di change management

Una risposta alle domande o un cambio di default aggiorna questo documento, l'ADR applicabile, i contratti, i requisiti, la matrice di tracciabilita e le evidenze di test. Nessuna decisione critica deve vivere solo in chat o in codice.
