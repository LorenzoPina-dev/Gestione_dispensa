# Functional flows

## Registration/login

Browser -> Keycloak -> JWT -> Gateway -> identity -> users. Passwords are never stored by application services.

## Family invitation

Owner -> families creates invitation -> notification event -> notification sends it -> recipient authenticates -> families validates token -> membership is created.

## Barcode

Camera/scanner -> barcode -> local product lookup -> OFF MongoDB cache -> OFF upstream on miss -> products -> user confirmation -> inventory.

## Product image

Image -> media/MinIO -> vision -> barcode/OCR/visual recognition -> product candidates -> user confirmation -> inventory.

## Receipt scan

Receipt image -> media -> vision/OCR -> receipt parser -> product/barcode matching -> confirmation -> inventory batch add.

## Pantry add/consume/waste

Client -> gateway -> inventory. Inventory updates current `pantry_items` transactionally and emits an event. When quantity reaches zero or an item is discarded, the current row is removed; the event remains in history.

## Expiration

Inventory item event -> expiration service -> known date or rule/model estimate -> prediction/confidence -> notification event when thresholds are reached.

## Shopping/restock

Inventory detects low stock -> `inventory.low_stock` event -> shopping creates/updates a list item -> offers can enrich the item with current promotions.

## Offers

Offer worker ingests sources -> normalization -> offers DB -> event -> search projection. Shopping queries offers by product/store/time validity.

## Recipes

Recipes indexes ingredients. Pantry matching considers availability, quantity, preferences and soon-to-expire products. Missing ingredients can be projected into a shopping list.

## Analytics

Domain events -> Kafka -> analytics consumers -> aggregate tables. Analytics never becomes the source of truth for domain state.
