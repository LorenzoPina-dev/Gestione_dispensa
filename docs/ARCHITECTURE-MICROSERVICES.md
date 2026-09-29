# Microservice architecture reference

Questo documento è il riferimento tecnico sintetico per i deployable attuali.

## Services

```text
3310 Identity
3311 Family
3312 Inventory
3313 Shopping
3314 Catalog
3315 Notifications
3316 Privacy
3317 Jobs
3401 Recipes
3402 Nutrition
3403 Stores
3404 Shelf-Life
3405 OCR
3200 OFF Lookup
3300 Gateway
```

Ogni servizio ha processo, HTTP boundary e persistence boundary propri. Il Gateway è l'unico API edge applicativo; Nginx è l'unico edge browser.

## Data ownership

`public` contiene i dati core assegnati ai servizi Identity/Family/Inventory/Shopping/Catalog/Notifications/Privacy/Jobs. I domini Recipes, Nutrition, Stores, Shelf-Life e OCR usano rispettivamente `recipes_domain`, `nutrition_domain`, `stores_domain`, `shelf_life_domain` e `ocr_domain`.

## Async

Redis è delivery transport; PostgreSQL resta source of truth per lo stato durevole dei job. I worker effettuano gli effetti e fanno ack solo dopo il commit.

## Non-negotiable boundaries

- nessun import TypeScript tra servizi;
- nessuna connessione browser a PostgreSQL/Redis/MongoDB;
- nessuna business rule nel Gateway;
- nessun dato pantry autorevole in MongoDB;
- nessun worker che bypassa i contratti di persistence del dominio.
