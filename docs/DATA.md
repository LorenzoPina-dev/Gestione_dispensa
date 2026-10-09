# Architettura dati

PostgreSQL è la source of truth transazionale. Il cluster è unico nel deployment locale, con ownership separata per dominio.

| Dominio | Owner |
|---|---|
| Identity/Family/Inventory/Shopping/Catalog/Notifications/Privacy/Jobs | servizi core |
| Recipes | service-recipes |
| Nutrition | service-nutrition |
| Stores | service-stores |
| Shelf-Life | service-shelf-life |
| OCR | service-ocr |

## Modello
```text
Family
 ├─ Membership / Invite
 ├─ Location
 ├─ StockItem ─ Lot ─ Movement
 ├─ ShoppingList ─ ShoppingItem
 ├─ Notifications
 ├─ Recipes / Nutrition
 ├─ Stores / Offers
 └─ OCR Jobs / Drafts

Product → Identifier / Alias / Provenance
```

## OpenFoodFacts
```text
barcode → Catalog → OFF Lookup
                    ├─ hit → prodotto
                    └─ miss → fallback remoto → cache
```
MongoDB è cache/read-through ricostruibile; non contiene la giacenza familiare.

## Redis / MinIO
Redis trasporta job/eventi; lo stato durevole dei job resta PostgreSQL.
MinIO contiene immagini prodotto, scontrini e allegati; PostgreSQL conserva ownership e metadata.

## Concorrenza
Usare `version`/ETag + `If-Match` per modifiche concorrenti e `X-Idempotency-Key` per mutazioni retryable.

## Migration
Le migration sono in `infra/postgres/migrations` e sono applicate da `db-migrate`. I container applicativi non eseguono migration all'avvio.
