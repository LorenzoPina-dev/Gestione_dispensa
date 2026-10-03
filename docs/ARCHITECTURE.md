# Architettura Microservices v2

## Modello
Ogni bounded context è un processo indipendente con codice, API, database, migration, credenziali, health/readiness, deploy e scaling propri.

**database-per-service è obbligatorio.** La condivisione fisica dell'istanza PostgreSQL in locale è solo un dettaglio di deployment: i database applicativi restano separati e non esistono tabelle condivise.

```
Browser -> Nginx -> Gateway
                    |-> Identity
                    |-> Family
                    |-> Inventory
                    |-> Shopping
                    |-> Catalog
                    |-> Notifications
                    |-> Privacy
                    |-> Jobs
                    |-> Recipes
                    |-> Nutrition
                    |-> Stores
                    |-> Shelf-Life
                    |-> OCR

Async: service transaction -> local Outbox -> per-database outbox-relay -> Redis Stream -> consumer worker -> service-owned DB. Ogni relay riceve una sola DATABASE_URL; nessun relay accede al DB di un altro service.
Data: Catalog -> OFF Lookup -> OpenFoodFacts MongoDB
Blob: OCR/Vision/Shelf-Life -> MinIO
```

Gateway: routing, auth context, correlation, rate limiting, error normalization e Composite Views. Non possiede dati di dominio.

HTTP è usato per operazioni immediate; eventi/job per OCR, vision, shelf-life, enrichment, notifiche e indicizzazione. Redis Streams è transport, non source of truth: Outbox e DB di dominio restano autorevoli.

Le mutazioni locali sono transazionali. Gli eventi usano Outbox Pattern, consumer idempotenti, retry bounded e DLQ. Non si usano transazioni distribuite.

## OFF product search architecture

La ricerca dei prodotti Open Food Facts è una capability locale-first e non deve dipendere da una chiamata HTTP esterna per ogni carattere digitato.

### Ownership

| Componente | Owner | Stato dei dati | Ruolo |
|---|---|---|---|
| MongoDB `off_lookup_db.products` | `off-lookup` | autorevole per il corpus OFF locale/cache | documenti OFF completi |
| OpenSearch indice `off-products-v1` | `search-indexer` | projection ricostruibile | ricerca e ranking |
| Search-a-licious / Search OFF | provider esterno, chiamato da `off-lookup` | non autorevole | fallback per query non presenti localmente |
| Catalog PostgreSQL | `service-catalog` | autorevole per il catalogo applicativo | normalizzazione/persistenza del prodotto selezionato |
| Inventory PostgreSQL | `service-inventory` | autorevole per la scorta | quantità, lotto, posizione, scadenza |

Nessun client browser accede direttamente a MongoDB, OpenSearch o al provider OFF.

### Flusso di ricerca per nome

```text
Browser
  -> Gateway
    -> Catalog
      -> off-lookup
        -> OpenSearch
             |-- hit -> risultati locali ranked
             `-- miss/unavailable -> Open Food Facts search API
                                      -> risultati fallback
                                      -> Mongo raw cache
                                      -> OpenSearch async upsert
```

OpenSearch è il solo motore locale della ricerca testuale. MongoDB non viene interrogato per nome
durante una richiesta utente: viene usato come corpus autorevole dal bootstrap e come cache completa
per i prodotti appresi dal provider. Se OpenSearch non contiene un match, `off-lookup` usa il provider
Open Food Facts e salva il risultato localmente così che le ricerche successive non dipendano dal provider.

### Selezione di un risultato

La selezione usa il codice EAN/GTIN come identificatore stabile e riusa il contratto barcode:

```text
risultato selezionato
  -> code
    -> POST /catalog/barcodes/resolve
       -> Catalog PostgreSQL
          |-- hit -> prodotto applicativo locale
          '-- miss -> off-lookup
                    -> MongoDB exact code
                       |-- hit -> documento OFF completo
                       '-- miss -> OFF API v3
                                  -> MongoDB upsert
                                  -> OpenSearch async upsert
                       -> Catalog persistExternalMatch
  -> UI candidate/confirm
  -> Inventory add
```

L'indice OpenSearch non è mai la fonte dei dati completi. Se un codice arriva dal provider fallback ma non è ancora in Mongo, il recupero completo avviene tramite il normale flusso barcode e l'indice viene aggiornato in modalità best-effort.

### Projection document

Il documento indicizzato è deliberatamente piccolo:

```json
{
  "code": "8000000000000",
  "name": "Golia",
  "nameExact": "golia",
  "brand": "Perfetti",
  "brandExact": "perfetti",
  "category": "confectionery-candy",
  "categoriesTags": ["en:candies"],
  "quantityLabel": "40 g",
  "imageUrl": "https://...",
  "productQuantity": 40,
  "productQuantityUnit": "g",
  "calories": 390,
  "protein": 0,
  "carbs": 96,
  "fat": 0,
  "fiber": 0,
  "popularityKey": 123,
  "completeness": 0.95,
  "searchText": "Golia Perfetti confectionery-candy en:candies 40 g"
}
```

Il documento di projection può essere eliminato e ricostruito in qualsiasi momento dal corpus Mongo; la perdita dell'indice non implica perdita di dati di dominio.

### Mapping e ranking

OpenSearch usa analisi lower-case + ASCII folding. Il recupero locale combina:

- corrispondenza esatta del nome;
- prefisso del nome;
- phrase match;
- token match con fuzziness automatica;
- marca e testo secondario.

Dopo il recupero iniziale viene applicato un ranking deterministico con segnali lexicali, completezza e popolarità. Questo ranking è la baseline verificabile e il punto di ingresso per un futuro reranker ML.

Il ranking non è una raccomandazione personalizzata e non contiene dati personali.

### Quality gate e ricerca multi-feature

Solo prodotti con `completeness >= 0.70` entrano nella projection OpenSearch. La stessa soglia viene applicata alla source Mongo del bootstrap, all'upsert live e alla ricerca (`range completeness >= 0.70`). Durante la migrazione, `off-mongodb-index-maintenance` elimina dal corpus Mongo i documenti sotto soglia o privi di una completezza numerica verificabile e `search-indexer` elimina eventuali documenti legacy non eleggibili.

La ricerca non è limitata al nome: OpenSearch interroga nome, marca, categoria, quantità e `featureText`. `featureText` aggrega labels, packaging, ingredienti, allergeni/traces, origini, paesi, negozi, gruppi alimentari, additivi, Nutri-Score e NOVA, quando presenti nel documento OFF. I match esatti/prefissi su nome e marca ricevono segnali più forti, ma una query per marca, categoria o caratteristica può produrre un risultato anche senza corrispondenza nel nome.

### Profilazione e ML futuri

La capability futura deve mantenere separati:

```text
OpenSearch top-N
   -> feature enrichment
      -> profile/ranking service
         -> ML reranker
            -> top-K UI
```

Gli eventi da raccogliere sono almeno `search_started`, `search_result_shown`, `product_clicked`, `product_confirmed` e `product_added`. Il profilo utente/famiglia e tali eventi non entrano nei documenti OFF. Un primo modello ammesso è un ranker tabulare; la ricerca semantica/hybrid è una fase successiva e non sostituisce l'accuratezza lexical di EAN/nome.

### Soglie operative

- debounce client: 250-400 ms;
- query minima: 3 caratteri;
- risultati UI: 8 di default;
- recupero interno OpenSearch: fino a 5x il limite UI;
- timeout ricerca off-lookup -> search-indexer: circa 700 ms;
- fallback esterno: solamente quando OpenSearch restituisce zero risultati o è indisponibile;
- cache query in-process: 30 s, massimo 50 query per istanza;
- sincronizzazione prodotto verso OpenSearch: asincrona e non bloccante;
- bootstrap corpus automatico: batch fino a 500 documenti con checkpoint e pausa tra i batch;
- reindex completo manuale: disponibile per mapping/code changes o ricostruzioni forzate.

I valori sono configurabili e devono essere verificati con benchmark sul dataset e hardware reali prima di dichiarare SLO di latenza.

### Rebuild e consistency

`search-indexer` crea l'indice se assente e avvia automaticamente il bootstrap dal corpus Mongo.
Il bootstrap è resumable: persiste il cursor solo dopo un bulk OpenSearch riuscito, si arresta temporaneamente
dopo un numero configurabile di batch e riprende da solo tramite retry timer. Uno stato `complete` è
terminale per quel corpus e impedisce di ripartire da capo ai successivi riavvii.

Il bootstrap porta in OpenSearch una projection compatta, non il documento OFF completo. La perdita o
ricostruzione dell'indice non comporta perdita del corpus Mongo.

Ogni cache miss barcode o ricerca fallback che produce un documento in Mongo tenta anche l'upsert della
projection nell'indice. Se OpenSearch è temporaneamente indisponibile, il prodotto resta persistito in
Mongo e viene reindicizzato quando il servizio torna disponibile.

### Regole non negoziabili

1. OpenSearch è una projection, non una source of truth.
2. MongoDB resta il proprietario dei documenti OFF completi.
3. Catalog non accede direttamente a MongoDB/OpenSearch.
4. Browser e Gateway non accedono direttamente a MongoDB/OpenSearch.
5. Search-a-licious non è il percorso principale durante la digitazione.
6. La selezione di un risultato usa il codice barcode e riusa il flusso barcode.
7. Nessun dato personalizzato viene scritto nel corpus OFF.
8. Nessuna perdita temporanea dell'indice deve rendere irrecuperabili i prodotti.
