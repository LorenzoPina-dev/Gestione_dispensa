# Flussi

## Barcode
Client -> Gateway -> Catalog -> OFF Lookup. OFF Lookup cerca MongoDB locale; se manca, provider OpenFoodFacts remoto e cache. Catalog normalizza; utente conferma; Inventory crea il prodotto e pubblica PantryItemAdded.

## Immagine
Upload -> MinIO -> job vision/OCR -> draft con confidence -> conferma utente -> service owner applica la mutazione.

## Scontrino
Upload MinIO -> OCR job -> OCR DB -> draft prodotti/prezzi -> conferma -> Catalog/Inventory/Stores.

## Scadenza
Inventory identifica il lotto -> Shelf-Life stima se manca la data reale -> prediction marcata estimated -> Notifications secondo policy. Una data dichiarata ha priorità.

## Consumo/scarto
Inventory aggiorna atomicamente quantità e movimento. A zero rimuove la riga dallo stato corrente; il ledger storico resta.

## Spesa
Inventory emette low-stock -> Shopping crea/suggerisce articolo. L'acquisto confermato non scrive direttamente Inventory: l'inserimento passa da Inventory.

## Ricette/nutrizione
Recipes/Nutrition leggono disponibilità/eventi; il consumo reale passa sempre da Inventory.

## Inviti
Family crea token temporaneo -> Notifications -> destinatario autenticato -> accept -> Family verifica e crea membership -> audit/outbox. La sola scansione del token non concede accesso.

## Dashboard
Gateway può comporre in parallelo Family + Inventory + Shopping + Recipes + Notifications. È read-only composition; le mutation restano ai service owner.
