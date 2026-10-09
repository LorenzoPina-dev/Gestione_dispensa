# Flussi applicativi

## Richiesta
```text
Browser → Nginx → Gateway → servizio owner → datastore/dipendenze → Gateway → Browser
```
Una mutazione appartiene al servizio owner. Gateway aggrega letture, non regole di dominio.

## Composite View
Gateway esegue letture parallele dei servizi necessari e restituisce un contratto unico alla UI.

## Barcode
```text
scan → Catalog → OFF Lookup → hit cache
                       └────→ miss → OpenFoodFacts → cache
```

## Dispensa
```text
UI → Gateway → Inventory → transaction → stock/lot/movement → outbox/job
```
Inventory mantiene la giacenza; i movimenti sono il ledger.

## Scadenza
```text
Inventory → Shelf-Life → risposta rapida
                      └→ job → worker → risultato → Notifications
```
Una predizione non sostituisce una data dichiarata disponibile.

## OCR
```text
upload → OCR job → Redis → worker-ocr → draft → review → conferma → Inventory/Stores
```
L'OCR non modifica direttamente la dispensa.

## Spesa/restock
Shopping possiede liste e articoli; Inventory fornisce lo stato della dispensa. Il restock può essere asincrono.

## Inviti
```text
creator → Family → token monouso
second user → resolve → auth → review → accept → membership + audit + outbox
```
La scansione non equivale all'accettazione.

Per ogni nuovo flusso documentare sempre owner dello stato, coordinatore, parte sync/async e idempotenza.
