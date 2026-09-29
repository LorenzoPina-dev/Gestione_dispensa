# Database architecture

## PostgreSQL ownership

PostgreSQL è un cluster logico unico con ownership separata per schema. La separazione degli schema evita collisioni nominali e rende esplicito il bounded context; non autorizza un servizio a modificare arbitrariamente le tabelle di un altro dominio.

```text
public
├── users
├── families / memberships / invites
├── products / identifiers / provenance
├── locations / stock_items / stock_lots / stock_movements
├── shopping_lists / shopping_items
├── notifications
├── privacy / job metadata
│
recipes_domain
├── recipes
└── recipe_ingredients

nutrition_domain
├── nutrition_targets
└── nutrition_logs

stores_domain
├── stores
└── store_prices

shelf_life_domain
└── rules

ocr_domain
├── jobs
└── drafts
```

## Relazioni principali

```text
family
 ├── memberships ── user
 ├── locations
 ├── stock_items ── stock_lots ── stock_movements
 ├── shopping_lists ── shopping_items
 ├── notifications
 ├── recipes
 ├── nutrition logs
 ├── stores ── store_prices
 └── OCR jobs/drafts
```

I domini estesi possono conservare `family_id` e identificativi dei prodotti core per mantenere il tenant/resource boundary senza duplicare l'anagrafica autorevole.

## Multi-tenant

Il livello applicativo verifica membership e ruolo. Il livello PostgreSQL deve applicare RLS alle tabelle tenant-scoped quando il deployment abilita il requisito di isolamento database.

La sessione DB deve impostare almeno:

```text
app.family_id
app.user_id
app.role
```

tramite `SET LOCAL` all'interno della transazione. Le policy RLS devono impedire letture/scritture fuori dal family scope anche in caso di query applicativa errata.

## Concurrency

Le risorse versionate espongono un ETag derivato dal `version`. Una mutazione con `If-Match` non corrispondente restituisce un conflitto e non modifica lo stato.

## Idempotency

Le mutazioni retryable registrano `X-Idempotency-Key` in un record durevole associato a family/principal/operation. Il retry dello stesso comando restituisce il risultato precedente senza creare un secondo effetto.

## Audit

L'audit transazionale deve conservare actor, family, entity, operation, timestamp, request/trace id e, per le operazioni che lo richiedono, stato before/after. Operational logs e audit trail sono storage differenti.

## MongoDB

`off-lookup` usa MongoDB come cache/read-through dell'OpenFoodFacts dump. Un miss può attivare fallback remoto e successivo enrichment. La perdita della cache non deve cancellare dati di dispensa.

## MinIO

MinIO contiene gli oggetti binari: immagini prodotto, immagini scontrino e allegati. PostgreSQL conserva metadata, ownership, hash e object key. Gli upload devono passare da validazione, limiti di dimensione e quarantine quando richiesto dal flusso.

## Migrations

Le migration sono ordinate e gestite dal runner esterno:

```text
infra/postgres/migrations/*.sql
```

Nessun container applicativo esegue migration automaticamente all'avvio.
