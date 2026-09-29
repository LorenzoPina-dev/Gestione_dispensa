# Data flows and UI contracts

## 1. Login

```text
UI → Gateway → Identity/Keycloak
                  ↓
                JWT
                  ↓
UI stores session state
```

Il token viene inviato al Gateway per ogni API autenticata.

## 2. Family onboarding

```text
Create family
  ↓
Family service
  ↓
family + owner membership
  ↓
invite code/QR
  ↓
member resolves code
  ↓
membership activation
```

## 3. Barcode

```text
UI scan barcode
  ↓
Catalog service
  ↓
Mongo OFF cache
  ├── hit → product candidate
  └── miss → external OFF lookup → cache
  ↓
UI confirmation
  ↓
Catalog product
```

## 4. Pantry quick add

```text
UI
 ↓
Catalog resolution
 ↓
Inventory stock item/lot
 ↓
if expiry missing
    ├── synchronous Shelf-Life prediction
    └── async refinement job
```

Una data manuale ha precedenza sulla data stimata.

## 5. Consume/discard

```text
UI mutation + If-Match + Idempotency-Key
  ↓
Inventory
  ↓
transaction
  ├── movement
  ├── quantity update
  ├── status update
  └── audit/outbox
  ↓
notification/event consumers
```

Quando la quantità raggiunge zero, il resource state deve seguire la policy di depletion configurata; non si conserva un falso stock attivo.

## 6. Receipt OCR

```text
UI upload
  ↓
MinIO
  ↓
OCR service creates job
  ↓
q:ocr-processing
  ↓
worker-ocr
  ↓
OCR draft + confidence
  ↓
UI human review
  ↓
confirm
  ↓
atomic transaction
 ├── inventory lots/movements
 ├── stores price history
 ├── OCR status = CONFIRMED
 └── audit
```

## 7. Shopping

```text
Inventory threshold / expiry
  ↓
worker-core
  ↓
shopping suggestion
  ↓
Shopping service
  ↓
UI
```

Offline:

```text
UI local mutation queue
  ↓
X-Idempotency-Key
  ↓
retry
  ↓
ETag conflict check
  ↓
server accept / conflict / merge policy
```

## 8. Cooking

```text
UI → Recipes /:id/cook
       ↓
Recipe ingredients
       ↓
Unit conversion
       ↓
Inventory consumption
       ↓
nutrition job/event
       ↓
Nutrition summary
```

## 9. Notifications

```text
Domain event/job
  ↓
worker-notifications
  ├── in-app
  ├── email provider
  └── push provider
       ↓
family member devices
```

Consent and quiet hours sono valutati prima della consegna esterna.

## 10. UI state contract

La UI distingue sempre:

- `loading`: nessun dato cached;
- `refreshing`: dati cached + revalidation;
- `offline`: mutazioni accodate localmente;
- `conflict`: ETag mismatch o merge necessario;
- `error`: richiesta fallita senza dati affidabili;
- `degraded`: una sezione opzionale della Composite View non disponibile.
