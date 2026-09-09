# Glossario di dominio

| Termine | Definizione normativa |
|---|---|
| **User** | Identita applicativa di una persona autenticata, collegata a uno o piu profili famigliari. |
| **Family** | Gruppo condiviso creato da un creator; contiene membership, scorte, liste e impostazioni condivise. Nel codice puo essere `family`; `household` e alias storico da migrare. |
| **Tenant** | Confine organizzativo superiore per installazioni retailer o B2B; una famiglia puo appartenere a un tenant. |
| **Store** | Punto vendita fisico o virtuale associato a un retailer e a un'area geografica. |
| **Membership** | Relazione tra user e family con ruolo, stato, timestamp e policy. |
| **Creator** | Primo membro e proprietario amministrativo della family. |
| **Member** | Membro con permessi operativi sulla family. |
| **Viewer** | Membro con sola lettura. |
| **Invite** | Invito temporaneo a entrare in una family; contiene token hash, ruolo proposto e scadenza. |
| **Join attempt** | Tentativo breve e legato a browser/sessione creato dopo la risoluzione di un invite. Non e una membership. |
| **Product** | Prodotto canonico, indipendente dalla specifica quantita posseduta. |
| **Product identifier** | Identificatore esterno come EAN/GTIN, SKU o alias; non e necessariamente unico globalmente senza fonte/scope. |
| **Package** | Formato commerciale di un prodotto, con quantita nominale e unita. |
| **Stock item** | Aggregato della quantita posseduta per family, prodotto, lotto, package, posizione e stato. |
| **Lot** | Gruppo fisico con scadenza, acquisto o provenienza comune. |
| **Movement** | Evento immutabile che modifica la quantita: receipt, consumption, waste, adjustment o transfer. |
| **Consumption** | Prelievo confermato o stimato dalla scorta; la fonte e sempre esplicita. |
| **Reorder point** | Soglia sotto la quale viene generato un suggerimento di acquisto. |
| **Shopping list** | Lista condivisa di righe da acquistare, con stato e origine. |
| **Shopping item** | Riga della lista riferita a prodotto/formato/quantita e a una o piu fonti di suggerimento. |
| **Suggestion** | Proposta non ancora confermata dall'utente; non modifica dati autorevoli da sola. |
| **Offer** | Prezzo/promozione con retailer, area, validita, condizioni, fonte e qualita. |
| **Recipe** | Ricetta verificata o proposta AI marcata, con ingredienti, porzioni e fonte. |
| **Nutrition profile** | Valori nutrizionali associati a prodotto/porzione con provenienza e qualita. |
| **Recognition candidate** | Valore proposto da barcode/OCR/vision con confidence ed evidenza. |
| **Capability** | Funzione attivabile come recognition, recipes, offers, notifications o search. |
| **Command** | Richiesta di cambiamento, idempotente e validata. |
| **Event** | Fatto gia avvenuto, versionato e pubblicabile a piu consumer. |
| **Projection** | Vista derivata ricostruibile da dati/eventi autorevoli. |
| **Outbox** | Record transazionale che garantisce pubblicazione affidabile dopo un cambiamento. |
| **Inbox** | Dedupe store del consumer per eventi gia elaborati. |
| **Job** | Lavoro asincrono con stato, tentativi, errore, risultato e trace. |
| **Source/provenance** | Origine, versione, timestamp, licenza e confidence di un dato. |
| **Profile feature** | Segnale aggregato e opt-in usato per personalizzazione, con TTL e versione. |
| **PII** | Informazione personale identificabile; non deve finire in log o eventi se non necessaria. |
| **SLO** | Obiettivo misurabile di affidabilita/prestazione. |
| **RPO/RTO** | Perdita dati massima accettabile / tempo massimo di ripristino. |

## Regole terminologiche

- usare `familyId` nei contratti nuovi; mantenere `householdId` solo come alias versionato durante migrazione;
- usare `productId` per il prodotto canonico e `stockItemId` per cio che e posseduto;
- distinguere sempre `suggested`, `accepted`, `completed` e `cancelled`;
- distinguere `estimated` da `confirmed` per consumo e nutrizione;
- non usare “AI result” come sinonimo di dato verificato;
- “delete” indica cancellazione conforme alla policy; per ledger/audit usare tombstone o anonimizzazione.
