# Conformità documentazione e implementazione

## Ambito della verifica

Questa pagina riassume ciò che è presente nel repository e nel Compose corrente. La definizione di un contratto, una directory o una tabella non dimostra da sola che una capability funzioni end-to-end. Per affermare che una funzione è verificata servono prove runtime/test appropriate; questa pagina non dichiara superati test che non sono stati eseguiti.

Fonti operative:

- `docker-compose.yml`: container, reti, healthcheck, dipendenze e profili;
- `services/*/src`: route e logica runtime;
- `services/*/migrations`: tabelle e vincoli;
- `docs/openapi.yaml`: contratto API browser;
- [DIAGRAMS.md](DIAGRAMS.md): schema sintetico e capability map.

## Copertura osservata

| Area | Owner / storage | Presente nel codice |
|---|---|---|
| Identità e preferenze dietetiche | Identity / `identity_db` | servizio e API |
| Famiglie, membership e inviti | Family / `family_db` | servizio, persistence e outbox |
| Dispensa, lotti, movimenti e policy | Inventory / `inventory_db` | servizio; event relay |
| Catalogo prodotti e barcode | Catalog / `catalog_db` | servizio, lookup OFF e provenance |
| Semantica alimentare | Food Semantics / `food_semantics_db` | resolver, bootstrap e API interne |
| Ricerca prodotti OFF | off-lookup + search-indexer / MongoDB + OpenSearch | lookup, fallback e indice derivato |
| Lista e riordino | Shopping / `shopping_db` | API e worker consumer |
| Ricette | Recipes / `recipes_db` | catalogo, ricerca, suggerimenti, aggiunta mancanti |
| Nutrizione | Nutrition / `nutrition_db` | target, diario e summary |
| Negozi e prezzi | Stores / `stores_db` | API |
| Scadenze | Shelf-Life / `shelf_life_db` | regole/profili/predizioni e worker |
| Ricevute OCR | OCR / `ocr_db` + Redis + MinIO | job e draft, dipendenti dalla configurazione provider/storage |
| Notifiche | Notifications / `notifications_db` | preferenze, record e consumer |
| Privacy | Privacy / `privacy_db` e Jobs | consensi e richieste; verificare i consumer necessari al completamento |
| Jobs e dead letter | Jobs / `jobs_db` + Redis | gestione e replay amministrativo |
| Ricetta completata → consumo dispensa → nutrienti | nessun endpoint owner rilevato | **non presente come flusso end-to-end nel main verificato** |

## Componenti repository e runtime

La presenza di source per worker-core, worker-integrations o scheduler non significa che il Compose attuale li avvii come servizi. L'elenco runtime è in [SERVICES.md](SERVICES.md). I processi avviati includono API, relay per dominio, worker OCR/shelf-life/shopping/notifications, componenti di ricerca e job one-shot di bootstrap/migrazione.

## Regola di aggiornamento

Quando cambia un'API o un flusso:

1. aggiornare il codice e la migration proprietaria;
2. aggiornare OpenAPI se la route è pubblica;
3. aggiornare il diagramma e la pagina di dominio;
4. verificare il runtime/test pertinente prima di dichiarare la capability funzionante.

Per schema tabellare vedere [DATA.md](DATA.md); per gli endpoint e i flussi vedere [DIAGRAMS.md](DIAGRAMS.md).
