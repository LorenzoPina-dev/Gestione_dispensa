# API Contract — Gateway + Internal HTTP

Versione contrattuale: **2.0**. Questo documento è normativo: implementazione e test devono rispettare esattamente path, metodo, header, status code, body, enum e regole di idempotenza qui definite.

## 1. Regole globali

### Base URL

Browser:
`https://<host>:8443/api`

Il browser non chiama direttamente i microservizi. Il Gateway inoltra alle porte interne definite in `SERVICES.md`.

### Header

| Header | Direzione | Obbligatorio | Regola |
|---|---|---:|---|
| Authorization | client -> gateway | sì per endpoint autenticati | `Bearer <OIDC access token>` |
| X-Request-Id | client/gateway | no | se assente il Gateway lo genera; viene propagato invariato |
| X-Correlation-Id | client/gateway | no | se assente viene generato; stesso workflow distribuito |
| X-Idempotency-Key | client -> gateway | per POST/PATCH/PUT/DELETE non-safe | chiave unica per la mutazione; TTL minimo 24h |
| If-Match | client -> gateway | per PATCH/DELETE concorrenti | ETag della versione letta |
| Content-Type | client -> gateway | per body | `application/json`, oppure `multipart/form-data` per upload |

Il Gateway non può modificare `sub`, `familyId` o altri claim di sicurezza. Il contesto autenticato viene propagato internamente con credenziali/service identity non falsificabili dal browser.

### ID e timestamp

- ID: UUID v4 in formato stringa.
- Date/time: ISO-8601 UTC, es. `2026-09-30T15:30:00Z`.
- Quantità: numero decimale non negativo.
- Denaro: intero in minor units + currency ISO 4217; mai float.
- Barcode: stringa numerica, senza normalizzare zeri iniziali.
- Paginazione: cursor-based, `limit` 1..100, risposta con `nextCursor`.
- Nessun campo sconosciuto è accettato nei request body salvo dove esplicitamente indicato.

### Risposta standard di successo

Le risposte sono JSON e contengono esclusivamente i campi documentati.

Lista:
```json
{
  "items": [],
  "nextCursor": null
}
```

Mutazione:
```json
{
  "data": {},
  "version": 1
}
```

### Errore standard

```json
{"error":{"code":"VALIDATION_ERROR","message":"Request validation failed","details":[{"field":"quantity","reason":"must_be_positive"}],"retryable":false,"requestId":"uuid"},"meta":{"requestId":"uuid","traceId":"uuid","schemaVersion":"1.0"}}
```

Il Gateway normalizza sia gli errori propri sia quelli provenienti dai microservizi nello stesso envelope. `meta.requestId` e `error.requestId` si riferiscono alla richiesta pubblica; `meta.traceId` è il trace distribuito.

Codici minimi:

| HTTP | code | Uso |
|---:|---|---|
| 400 | VALIDATION_ERROR | body/query/path/header non valido |
| 401 | UNAUTHENTICATED | token mancante/non valido |
| 403 | FORBIDDEN | identità autenticata ma non autorizzata |
| 404 | NOT_FOUND | risorsa inesistente |
| 409 | CONFLICT | vincolo di dominio o idempotency conflict |
| 412 | PRECONDITION_FAILED | ETag/If-Match non più valido |
| 422 | BUSINESS_RULE_VIOLATION | input sintatticamente valido ma dominio invalido |
| 429 | RATE_LIMITED | rate limit |
| 502 | UPSTREAM_ERROR | provider/servizio downstream fallito |
| 503 | SERVICE_UNAVAILABLE | servizio temporaneamente non disponibile |
| 504 | UPSTREAM_TIMEOUT | timeout downstream |

Un endpoint pubblico non può inventare un diverso formato errore.


## 2. Identity

### GET /identity/me

Response 200:
```json
{
  "data": {
    "userId": "uuid",
    "subject": "oidc-sub",
    "email": "user@example.com",
    "displayName": "Mario Rossi",
    "avatarUrl": null,
    "locale": "it-IT",
    "timezone": "Europe/Rome",
    "createdAt": "2026-09-30T15:30:00Z",
    "updatedAt": "2026-09-30T15:30:00Z"
  }
}
```

### PATCH /identity/me

Request:
```json
{
  "displayName": "Mario Rossi",
  "avatarUrl": null,
  "locale": "it-IT",
  "timezone": "Europe/Rome"
}
```

Tutti i campi sono opzionali; almeno uno deve essere presente. Response 200 come GET.

## 2A. Authentication operations

These endpoints are part of the public application contract because registration, password reset and local logout are required before/after an authenticated Identity profile exists.

### POST /auth/register

Request:
```json
{"name":"Mario Rossi","email":"user@example.com","password":"..."}
```
Response 201:
```json
{"data":{"success":true,"message":"..."}}
```

### POST /auth/reset-password

Request:
```json
{"email":"user@example.com"}
```
Response 202:
```json
{"data":{"accepted":true,"message":"..."}}
```

### POST /auth/logout

No request body. Response 204. Logout is client-token disposal; the Identity service has no server-side browser session to invalidate.

## 3. Families

### GET /families

Query: `limit`, `cursor`.

Response 200:
```json
{"items":[{"familyId":"uuid","name":"Casa","role":"owner","memberCount":3,"createdAt":"2026-09-30T15:30:00Z"}],"nextCursor":null}
```

### POST /families

Request:
```json
{"name":"Casa"}
```
Response 201:
```json
{"data":{"familyId":"uuid","name":"Casa","role":"owner","createdAt":"2026-09-30T15:30:00Z"},"version":1}
```

### GET /families/{familyId}

Response 200:
```json
{"data":{"familyId":"uuid","name":"Casa","members":[{"userId":"uuid","displayName":"Mario","role":"owner","joinedAt":"2026-09-30T15:30:00Z"}],"version":3}}
```

### GET /families/{familyId}/members

Response 200:
```json
{"items":[{"userId":"uuid","role":"member","status":"ACTIVE","version":3,"joinedAt":"2026-09-30T15:30:00Z"}],"nextCursor":null}
```

### PATCH /families/{familyId}/members/{userId}

Request: `{"role":"member"}`. Allowed role values: `admin` | `member` | `viewer`. Owner transfer is a dedicated future contract so ownership cannot be accidentally removed.

Response 200: membership + version.

### DELETE /families/{familyId}/members/{userId}

Response 204. Owner cannot be removed unless another owner is established by a dedicated ownership-transfer operation.

### PATCH /families/{familyId}

Request:
```json
{"name":"Casa nuova"}
```
Response 200: family object + version.

### DELETE /families/{familyId}

Response 204. L'operazione richiede ruolo owner e avvia eventuali workflow privacy/erasure definiti in `SECURITY.md`.

### POST /families/{familyId}/invites

Request:
```json
{"email":"invitee@example.com","role":"member","expiresInSeconds":86400}
```
`role` = `member`, `admin` oppure `viewer`. `expiresInSeconds`: 3600..604800. `email` è opzionale e viene usata solo come destinatario descrittivo dell'invito.

Response 201:
```json
{"data":{"inviteId":"uuid","email":"invitee@example.com","role":"member","status":"pending","expiresAt":"2026-10-01T15:30:00Z","fallbackCode":"123456","qrPayload":"opaque-token"},"version":1}
```
`fallbackCode` e `qrPayload` sono restituiti alla creazione e non vengono persistiti in chiaro.

### GET /families/{familyId}/invites

Response 200:
```json
{"items":[{"inviteId":"uuid","email":"invitee@example.com","role":"member","status":"pending","expiresAt":"2026-10-01T15:30:00Z","createdAt":"2026-09-30T15:30:00Z"}],"nextCursor":null}
```

### DELETE /families/{familyId}/invites/{inviteId}

Response 204. Revoca il token; non modifica membership esistenti.

### POST /family-invites/resolve

Request:
```json
{"token":"opaque-token","browserBindingHash":"hex-hash"}
```
Crea un `join attempt` temporaneo e non modifica la membership. Response 200:
```json
{"data":{"id":"uuid","inviteId":"uuid","userId":"uuid","state":"PENDING_REVIEW","expiresAt":"2026-10-01T15:45:00Z","familyId":"uuid","role":"MEMBER"},"version":1}
```

### POST /family-invites/resolve-code

Request:
```json
{"code":"123456","browserBindingHash":"hex-hash"}
```
Stesso comportamento di `resolve`, usando il codice alternativo.

### POST /invites/{attemptId}/accept

Request:
```json
{"consentVersion":"privacy-consent-v1"}
```
Response 201:
```json
{"data":{"familyId":"uuid","userId":"uuid","role":"member","joinedAt":"2026-10-01T15:30:00Z"},"version":1}
```
Il `join attempt` e l'invito vengono consumati atomicamente; la chiamata richiede `X-Idempotency-Key`.

### GET /family-invites/{token}

Response 200:
```json
{"data":{"inviteId":"uuid","familyName":"Casa","role":"member","status":"pending","expiresAt":"2026-10-01T15:30:00Z"}}
```
Non concede membership.


## 4. Inventory

### GET /inventory

Query: `familyId`, `status=current`, `limit`, `cursor`.

Response 200:
```json
{"items":[{"itemId":"uuid","productId":"uuid","lotId":"uuid","name":"Latte","quantity":2,"unit":"L","expiresAt":"2026-10-05T00:00:00Z","expirationSource":"declared","location":"fridge","version":4}],"nextCursor":null}
```

### GET /inventory/{itemId}

Response 200: item completo come sopra, includendo `addedAt`, `openedAt`, `updatedAt`.

### POST /inventory/items

Request:
```json
{
  "productId":"uuid",
  "quantity":2,
  "unit":"L",
  "expiresAt":"2026-10-05T00:00:00Z",
  "location":"fridge",
  "lotCode":"LOT-123"
}
```
`productId` è Catalog ID. Se `expiresAt` è omesso il sistema può avviare Shelf-Life; non è lecito creare direttamente una data stimata nel client.

Response 201: item + version.

### PATCH /inventory/{itemId}

Request: almeno uno tra `quantity`, `location`, `expiresAt`, `lotCode`.
Response 200: item + version.

### POST /inventory/{itemId}/consume

Headers: `If-Match: <version>` e `X-Idempotency-Key` obbligatori.

Request:
```json
{"quantity":1,"reason":"used"}
```
`reason`: `used` | `expired` | `damaged` | `other`.

Response 200:
```json
{"data":{"itemId":"uuid","consumedQuantity":1,"remainingQuantity":1,"removed":false},"version":5}
```
Se `remainingQuantity=0`, `removed=true` e la riga corrente viene eliminata. Il movimento storico resta.

### POST /inventory/{itemId}/waste

Headers: `If-Match: <version>` e `X-Idempotency-Key` obbligatori.

Request:
```json
{"quantity":2,"reason":"spoiled"}
```
Response 200:
```json
{"data":{"itemId":"uuid","wastedQuantity":2,"remainingQuantity":0,"removed":true},"version":6}
```

### GET /inventory/{itemId}/movements

Query: `limit`, `cursor`.

Response 200:
```json
{"items":[{"movementId":"uuid","type":"waste","quantity":2,"reason":"spoiled","occurredAt":"2026-09-30T15:30:00Z","actorUserId":"uuid"}],"nextCursor":null}
```

### POST /inventory/{itemId}/expiration/confirm

Request:
```json
{"expiresAt":"2026-10-05T00:00:00Z","source":"declared"}
```
Response 200: item aggiornato. `source` = `declared` quando la data viene fornita/confermata dall’utente; `estimated` quando viene applicata una prediction Shelf-Life. Una data `declared` ha priorità sulla prediction.

## 5. Catalog / barcode

### GET /catalog/products/{productId}

Response 200:
```json
{"data":{"productId":"uuid","name":"Latte intero","brand":"Marca","category":"milk","barcodes":["8000000000000"],"imageObjectKey":null,"nutrition":{"kcalPer100g":62},"source":{"type":"openfoodfacts","id":"123"},"version":2}}
```

### GET /catalog/barcodes/{barcode}

Query opzionale: `refresh=false`.

Response 200:
```json
{"data":{"resolution":"cache","product":{"productId":"uuid","name":"Latte intero","brand":"Marca","barcodes":["8000000000000"],"source":{"type":"openfoodfacts","id":"123"}}}}
```
404 se nessun provider trova il barcode.

### POST /catalog/products

Headers: `X-Idempotency-Key` obbligatorio.

Request:
```json
{"name":"Latte intero","brand":"Marca","defaultUnit":"L","barcodes":["8000000000000"],"category":"milk","calories":62,"protein":3.2,"carbs":4.8,"fat":3.5,"fiber":0}
```

`name` è obbligatorio. `defaultUnit` è opzionale e defaulta a `piece`. `barcodes` è opzionale per prodotti manuali; quando presente ogni valore deve contenere 8..14 cifre. I campi nutrizionali opzionali `calories`, `protein`, `carbs`, `fat`, `fiber` sono non negativi.

Response 201:
```json
{"data":{"productId":"uuid","name":"Latte intero","brand":"Marca","category":"milk","barcodes":["8000000000000"],"imageObjectKey":null,"nutrition":{"kcalPer100g":null,"proteinGPer100g":null,"carbsGPer100g":null,"fatGPer100g":null,"fiberGPer100g":null},"source":{"type":"manual","id":"manual"},"version":1},"meta":{"requestId":"uuid","traceId":"uuid","schemaVersion":"1.0"}}
```

### PATCH /catalog/products/{productId}

Headers: `If-Match: <version>` e `X-Idempotency-Key` obbligatori.

Il valore di `If-Match` deve coincidere con la `version` corrente; mismatch = `412 PRECONDITION_FAILED`.


## 6. Shopping

### GET /shopping/lists
Query: `familyId`, `limit`, `cursor`.

Response 200:
```json
{"items":[{"listId":"uuid","name":"Spesa","status":"open","itemCount":4,"version":2}],"nextCursor":null}
```

### POST /shopping/lists

Request: `{"familyId":"uuid","name":"Spesa"}`. `familyId` identifica la famiglia autenticata e viene verificato dal Gateway/Family boundary. Response 201 list + version.

### GET /shopping/lists/{listId}

Response 200:
```json
{"data":{"listId":"uuid","name":"Spesa","status":"open","items":[{"itemId":"uuid","productId":"uuid","label":"Latte","quantity":2,"unit":"L","checked":false,"version":1}],"version":2}}
```

### POST /shopping/lists/{listId}/items

Request:
```json
{"productId":"uuid","label":"Latte","quantity":2,"unit":"L"}
```
Response 201 item + version.

### PATCH /shopping/lists/{listId}/items/{itemId}

Request: any of `label`, `quantity`, `unit`, `checked`. Requires `If-Match` containing the current item `version` and `X-Idempotency-Key`. Response 200: item + version.

### DELETE /shopping/lists/{listId}/items/{itemId}

Response 204.

### POST /shopping/lists/{listId}/close

Body `{}`. Response 200 with status `closed`.

## 7. Recipes

### GET /recipes
Query: `limit`, `cursor`, `q`.

Response 200:
```json
{"items":[{"recipeId":"uuid","title":"Pasta al pomodoro","servings":2,"ingredients":[{"productId":"uuid","name":"Pomodoro","quantity":300,"unit":"g"}]}],"nextCursor":null}
```

### POST /recipes

Request:
```json
{"title":"Pasta al pomodoro","servings":2,"ingredients":[{"productId":"uuid","name":"Pomodoro","quantity":300,"unit":"g"}],"steps":["..."]}
```
Response 201 recipe + version.

### GET /recipes/{recipeId}

Response 200 recipe completo.

### PATCH /recipes/{recipeId}

Request: campi recipe modificabili. Response 200.

### DELETE /recipes/{recipeId}

Response 204.

### POST /recipes/{recipeId}/add-missing

Body: `{ "familyId": "uuid" }`.
Verifica la disponibilità corrente in Inventory e aggiunge alla lista Shopping attiva solo gli ingredienti mancanti o insufficienti. L’orchestrazione non modifica direttamente il database Recipes o Shopping.
Response 200:
```json
{"data":{"itemIds":["uuid","uuid"]},"version":1}
```
### GET /recipes/suggestions

Query: `familyId`, `limit`.
Response 200:
```json
{"items":[{"recipeId":"uuid","score":0.87,"missingIngredients":[{"productId":"uuid","name":"Basilico"}]}]}
```
Lo `score` è un valore tecnico del ranking, non una garanzia.

## 8. Nutrition

### GET /nutrition/targets
Response 200:
```json
{"data":{"caloriesKcal":2200,"proteinG":120,"carbsG":250,"fatG":70,"version":1}}
```

### PUT /nutrition/targets

Request: stessi campi numerici, tutti obbligatori. Response 200.

### GET /nutrition/diary

Query: `from`, `to`, `limit`, `cursor`.

Response 200:
```json
{"items":[{"entryId":"uuid","date":"2026-09-30","meal":"lunch","productId":"uuid","quantity":250,"unit":"g","source":"inventory"}],"nextCursor":null}
```

### POST /nutrition/diary

Request:
```json
{"date":"2026-09-30","meal":"lunch","productId":"uuid","quantity":250,"unit":"g"}
```
Response 201 entry + version.

### GET /nutrition/summary

Query: `period=today|week`, optional `familyId`.

Response 200:
```json
{"data":{"caloriesKcal":2200,"proteinG":120,"carbsG":250,"fatG":70,"period":"today"}}
```

This is a read-only composite nutrition summary used by the application dashboard. It does not replace the canonical nutrition targets or diary resources.

## 9. Stores / offers

### GET /stores
Query: `q`, `limit`, `cursor`.
Response 200:
```json
{"items":[{"storeId":"uuid","name":"Supermercato","address":"...","chain":"..."}],"nextCursor":null}
```

### POST /stores

Request: `{"name":"Supermercato","chain":"..." ,"address":"..." }`. Response 201.

### GET /stores/{storeId}/prices

Query: `productId`, `limit`, `cursor`.
Response 200:
```json
{"items":[{"priceId":"uuid","productId":"uuid","storeId":"uuid","amountMinor":199,"currency":"EUR","observedAt":"2026-09-30T15:30:00Z"}],"nextCursor":null}
```

### GET /stores/{storeId}/offers

Query: `active=true`, `productId`, `limit`, `cursor`.
Response 200:
```json
{"items":[{"offerId":"uuid","productId":"uuid","storeId":"uuid","type":"percentage","value":20,"validFrom":"2026-09-30T00:00:00Z","validTo":"2026-10-05T23:59:59Z"}],"nextCursor":null}
```

### POST /stores/{storeId}/prices

Request:
```json
{"productId":"uuid","amountMinor":199,"currency":"EUR","observedAt":"2026-09-30T15:30:00Z","source":"receipt"}
```
Response 201: price record + version.

### POST /stores/{storeId}/offers

Request:
```json
{"productId":"uuid","type":"percentage","value":20,"validFrom":"2026-09-30T00:00:00Z","validTo":"2026-10-05T23:59:59Z"}
```
Response 201 offer + version.

## 10. Notifications

### GET /notifications
Query: `familyId`, `unreadOnly`, `limit`, `cursor`.
Response 200:
```json
{"items":[{"notificationId":"uuid","type":"expiration","title":"Scadenza vicina","body":"Latte scade tra 2 giorni","readAt":null,"createdAt":"2026-09-30T15:30:00Z"}],"nextCursor":null}
```

### POST /notifications/{notificationId}/read

Body `{"familyId":"uuid"}`. Response 200 notification + version.

### GET /notifications/preferences
Response 200:
```json
{"data":{"expiration":true,"lowStock":true,"offers":false,"family":true,"system":true,"channels":{"inApp":true,"email":false,"push":false},"version":1}}
```

### PUT /notifications/preferences

Request: stesso schema. Response 200.

## 11. OCR e scansione immagini

### POST /ocr/jobs

Multipart: campo `file` obbligatorio; `type` = `receipt` | `pantry_image`; `familyId` obbligatorio.
Response 202:
```json
{"data":{"jobId":"uuid","status":"queued","type":"receipt","objectKey":"ocr/..."}}
```

### GET /ocr/jobs

Query: `familyId`, optional `status`, `limit`, `cursor`.

Response 200:
```json
{"items":[{"jobId":"uuid","status":"needs_review","type":"receipt","progress":100,"draftId":"uuid","error":null}],"nextCursor":null}
```

### GET /ocr/jobs/{jobId}

Response 200:
```json
{"data":{"jobId":"uuid","status":"completed","type":"receipt","progress":100,"draftId":"uuid","error":null}}
```
Status: `queued` | `processing` | `completed` | `needs_review` | `failed` | `cancelled`.

### GET /ocr/drafts/{draftId}

Response 200:
```json
{"data":{"draftId":"uuid","jobId":"uuid","type":"receipt","confidence":0.94,"items":[{"name":"Latte","barcode":null,"quantity":1,"unit":"L","priceMinor":159,"currency":"EUR","confidence":0.91}]}}
```

### POST /ocr/drafts/{draftId}/reject

Body `{}`. Response 200: draft with status `rejected`.

### POST /ocr/drafts/{draftId}/confirm

Request:
```json
{"items":[{"name":"Latte","productId":"uuid","quantity":1,"unit":"L","priceMinor":159,"currency":"EUR"}]}
```
Response 200:
```json
{"data":{"draftId":"uuid","status":"confirmed","applied":false}}
```
La conferma chiude il draft e produce OcrDraftConfirmed. L'applicazione ai domini avviene tramite i rispettivi owner: Catalog risolve il prodotto, Stores registra il prezzo e Inventory registra la scorta. Ogni mutation è idempotente.

## 12. Shelf-Life

### POST /shelf-life/predictions

Request:
```json
{"itemId":"uuid","productId":"uuid","storedAt":"fridge","opened":false}
```
Response 202:
```json
{"data":{"predictionId":"uuid","status":"queued"}}
```

### GET /shelf-life/predictions/{predictionId}

Response 200:
```json
{"data":{"predictionId":"uuid","itemId":"uuid","estimatedExpiresAt":"2026-10-05T00:00:00Z","confidence":0.81,"basis":"product_category+storage","status":"completed"}}
```
Una prediction non sostituisce una data dichiarata.

### POST /shelf-life/predictions/{predictionId}/apply

Body `{}`. Response 200 con prediction applicata. Il service Inventory resta owner della current pantry state.

## 12A. Shelf-Life internal processing

The worker does not access `shelf_life_db` directly. It calls the owner service using the internal service credential.

### POST /internal/shelf-life/predictions/{predictionId}/process

Headers:
`Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`

Request:
```json
{"itemId":"uuid","productId":"uuid","storedAt":"fridge","opened":false,"category":"dairy"}
```

Response 200: completed prediction. A missing active rule returns 422 `PREDICTION_UNAVAILABLE`.

This endpoint is backend-only and is never exposed through the Gateway.

## 13. Privacy

### GET /privacy/consents
Response 200:
```json
{"data":{"analytics":false,"personalization":false,"notifications":true,"version":3}}
```

### PUT /privacy/consents

Request: stesso schema. Response 200.

### POST /privacy/export

Body `{}`. Response 202:
```json
{"data":{"jobId":"uuid","status":"queued"}}
```

### POST /privacy/erase

Request:
```json
{"confirm":true}
```
Response 202:
```json
{"data":{"jobId":"uuid","status":"queued"}}
```
La cancellazione è orchestrata senza query cross-DB.

## 14. Jobs

Gli endpoint Jobs sono interni al piano backend e non esposti al browser. Richiedono `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`, dove il token è una credenziale service-to-service e non un token OIDC utente.

### POST /internal/jobs

Request:
```json
{"type":"shelf_life_prediction","payload":{"itemId":"uuid"},"deduplicationKey":"inventory-item-uuid"}
```
Response 202: job.

### GET /internal/jobs/{jobId}

Response 200:
```json
{"data":{"jobId":"uuid","type":"shelf_life_prediction","status":"queued","attempt":0,"maxAttempts":5,"createdAt":"2026-09-30T15:30:00Z"}}
```

## 15A. Screen Composite Views

Questi endpoint sono read models ottimizzati per il browser. Non sono source of truth e non introducono ownership dati.

### GET /views/dashboard-today
Query obbligatoria: `familyId`. Response 200: stessa struttura di `GET /dashboard`.

### GET /views/pantry-screen
Query obbligatoria: `familyId`. Response 200:
```json
{"data":{"familyId":"uuid","pantry":{"items":[],"nextCursor":null},"shopping":null,"notifications":{"items":[],"nextCursor":null},"navigationSummary":{}}}
```

### GET /views/shopping-screen
Query obbligatoria: `familyId`. Response 200: view con shopping corrente, pantry e notifications.

### GET /views/recipes-screen
Query obbligatoria: `familyId`. Response 200: view con recipe suggestions, pantry, shopping e notifications.

### GET /views/nutrition-screen
Query obbligatoria: `familyId`. Response 200: view con nutrition summary, pantry e notifications.

### GET /views/family-screen
Query obbligatoria: `familyId`. Response 200: view con family, members, invites e navigation summary.

### GET /views/notifications-screen
Query obbligatoria: `familyId`. Response 200: view con notifications, pantry e navigation summary.

Tutte le screen views sono GET autenticati. Se un downstream fallisce, il Gateway restituisce un errore documentato oppure una view parziale solo secondo la regola di `partialFailures`; non vengono sintetizzati dati domain falsi.

## 15. Composite Views

Sono esclusivamente GET e non sono source of truth.

### GET /dashboard

Query obbligatoria: `familyId`.

Response 200:
```json
{
  "data":{
    "family":{"familyId":"uuid","name":"Casa"},
    "inventory":{"items":[],"nextCursor":null},
    "shopping":{"items":[],"nextCursor":null},
    "recipes":{"items":[]},
    "notifications":{"items":[],"nextCursor":null}
  },
  "partialFailures":[]
}
```

Se un downstream fallisce, il Gateway non finge dati vuoti: `partialFailures` identifica `service`, `code` e `requestId`. HTTP 200 è ammesso per una Composite View parziale solo se il contratto UI supporta esplicitamente la degradazione; altrimenti 503/504.

## 16. Health

Ogni servizio espone internamente:

- `GET /health/live` -> 200 se il processo è vivo.
- `GET /health/ready` -> 200 solo se il servizio può operare con le proprie dipendenze obbligatorie.

Questi endpoint non richiedono OIDC e non sono esposti al browser.

## 17. Regole di implementazione

1. Ogni endpoint ha request schema, response schema e codici errore definiti prima del codice.
2. Nessun endpoint usa `any` nel contratto pubblico.
3. I client generano solo richieste conformi a OpenAPI.
4. Il server valida sempre body, query, path e header.
5. Le mutation che possono essere ritentate richiedono `X-Idempotency-Key`.
6. Le mutation concorrenti che supportano optimistic locking richiedono `If-Match`.
7. Un service non può restituire dati appartenenti a un altro owner come se fossero propri.
8. I contratti interni seguono le stesse regole di versioning, errori, tracing e idempotenza.
