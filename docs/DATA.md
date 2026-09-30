# Data architecture

## Database per microservizio
```
identity_db
family_db
inventory_db
shopping_db
catalog_db
notifications_db
privacy_db
jobs_db
recipes_db
nutrition_db
stores_db
shelf_life_db
ocr_db
off_lookup_db
```

Ogni DB ha owner, credenziali e migration propri. Un server PostgreSQL condiviso in Docker è ammesso solo come hosting locale di database distinti. In produzione possono diventare istanze separate senza modificare i contratti.

### Ownership
**Inventory:** stato corrente della dispensa + ledger movimenti. Quantità zero o spreco rimuovono l'elemento dallo stato corrente; lo storico può restare.

**Catalog:** prodotto canonico e provenance, non pantry utente.

**OFF Lookup:** MongoDB separato con dump/cache OpenFoodFacts; non è source of truth della dispensa.

**OCR:** job, confidence e draft; un draft non muta Inventory senza conferma.

**Shelf-Life:** regole e predizioni; una scadenza dichiarata prevale su una stimata.

**Stores:** negozi, prezzi, offerte.

**Shopping:** liste/articoli; low-stock può essere suggerito da Inventory ma Shopping non scrive Inventory.

**MinIO:** immagini/ricevute/attachment. PostgreSQL del servizio proprietario conserva metadata, ownership, object key e checksum.

**Redis:** cache, lock e trasporto transient; la verità durevole resta nei DB dei servizi.

Per dati di un altro dominio: API, evento/projection locale o Composite View. Mai JOIN/accesso al DB remoto.
