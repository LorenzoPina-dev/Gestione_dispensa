# ADR-0003: strategia database polyglot controllata

- **Stato**: accettata
- **Data**: 2026-09-09
- **Decisione**: PostgreSQL autorevole, Redis operativo, proiezioni specializzate solo su evidenza

## Contesto

Il dominio combina membership famigliare, ruoli, inviti QR, inventario con ledger, liste, catalogo, nutrizione, offerte, ricerca, job e profilazione. Il deployment iniziale usa un vecchio PC, mentre il target futuro include Kubernetes e catene di supermercati.

## Opzioni

- più database relazionali per microservizio dal primo giorno;
- MongoDB/document database per catalogo e dati variabili;
- key-value distribuito per alta scala;
- graph database per famiglie e raccomandazioni;
- PostgreSQL come fonte con proiezioni Redis/search/graph/warehouse.

## Decisione

Adottiamo l'ultima opzione:

- PostgreSQL mantiene aggregati e invarianti del dominio;
- Redis gestisce cache, lock brevi, rate limit e code operative ricostruibili;
- S3-compatible conserva bytes e media;
- PostgreSQL FTS/trigram copre la ricerca iniziale;
- OpenSearch puo diventare una proiezione per grandi cataloghi e ranking;
- graph DB puo diventare una proiezione per recommendation multi-hop, non per identity o inventory;
- warehouse/lakehouse e riservato ad analytics aggregati enterprise.

## Motivazioni

Membership e inviti richiedono unique constraint e transazioni. Inventario e consumi richiedono un ledger coerente. Outbox e audit richiedono scrittura atomica. PostgreSQL risolve questi casi con meno componenti e meno failure mode rispetto a un insieme polyglot prematuro.

Un grafo concettuale non implica un graph database. `family -> membership -> user` e una relazione relazionale semplice; `product -> ingredient -> recipe -> preference` puo essere interrogata con SQL, read model o search finche il volume resta gestibile.

## Conseguenze

### Positive

- server domestico piu leggero e manutenibile;
- consistenza forte per dati critici;
- backup e restore concentrati sulla fonte autorevole;
- proiezioni specializzate ricostruibili;
- percorso graduale a Kubernetes e scala enterprise.

### Negative

- PostgreSQL puo diventare collo di bottiglia se query e indici sono progettati male;
- la consistenza delle proiezioni e eventuale;
- introdurre OpenSearch/graph in seguito richiede pipeline replay e governance;
- un singolo PostgreSQL non fornisce alta disponibilita senza infrastruttura aggiuntiva.

## Criteri di revisione

La decisione viene riaperta solo con benchmark che dimostri uno dei seguenti casi:

- p95 o throughput non raggiungibili dopo ottimizzazione e read model;
- catalogo/ranking non gestibile con PostgreSQL search;
- attraversamenti graph multi-hop misurabilmente superiori con graph DB;
- isolamento tenant, compliance o workload che richiedono database separati;
- analytics che competono con transazioni e richiedono warehouse.

Ogni revisione deve includere owner dati, consistenza, backup/restore, costi, failure mode, migrazione, osservabilita e piano di rimozione.
