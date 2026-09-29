-- =============================================================================================
-- 0017_pantry-optimization-and-new-features.sql
--
-- Refactoring architetturale del modello di dispensa (vedi docs/GAP-ANALYSIS.md e la richiesta
-- di ottimizzazione DB/backend). Questa migrazione segue la strategia "expand" del pattern
-- expand/contract per garantire ZERO-DOWNTIME e piena compatibilità retroattiva con il codice
-- applicativo attualmente deployato (services/inventory, services/shopping):
--
--   FASE 1 (questa migrazione, "expand"):
--     - aggiunge nuove colonne/tabelle/indici SENZA rimuovere nulla che il codice corrente legge;
--     - introduce i nuovi vincoli come AGGIUNTIVI accanto a quelli storici;
--     - i trigger mantengono le nuove colonne denormalizzate sincronizzate in automatico.
--   FASE 2 ("contract", migrazione futura 0018+, DOPO il deploy del codice applicativo
--     aggiornato in questo stesso changeset):
--     - drop di stock_items.location_id / stock_items.package_id e dell'indice
--       stock_items_active_semantic_idx (sostituiti da stock_lots.location_id e da
--       stock_items_active_product_idx introdotti qui);
--     - drop della tabella stock_thresholds (sostituita dalla vista di compatibilità
--       creata qui, che a sua volta punta a stock_items);
--     - drop di shopping_item_sources (sostituita da shopping_items.sources).
--
-- PREREQUISITO DATI per la nuova chiave "un solo stock_item ACTIVE per (family_id, product_id)":
-- su un database con dati reali che abbia GIÀ più stock_items ACTIVE per lo stesso prodotto in
-- location diverse, l'indice stock_items_active_product_idx creato più sotto fallirà finché quelle
-- righe non vengono consolidate (stesso pattern difensivo già usato in 0016_stock-dedup.sql).
-- Query diagnostica:
--   SELECT family_id, product_id, count(*) FROM stock_items WHERE status = 'ACTIVE'
--   GROUP BY 1, 2 HAVING count(*) > 1;
-- Su un database dev/fresh (nessun dato) questa migrazione è un no-op rispetto a questo rischio.
-- =============================================================================================

BEGIN;

-- -------------------------------------------------------------------------------------------
-- 0. Estensioni
-- -------------------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -------------------------------------------------------------------------------------------
-- 1. Denormalizzazione di stock_items: total_quantity / earliest_expiry_at
--
-- Letti in continuazione dalla vista dispensa (ordinamento per scadenza, badge "in scadenza"),
-- oggi richiedono una subquery/aggregate su stock_lots per ogni riga. Denormalizzarli su
-- stock_items e mantenerli con un trigger sposta il costo dalla lettura (hot path, target <50ms)
-- alla scrittura (rara in confronto). total_quantity è pensato come ALIAS di sola lettura,
-- ottimizzato per compatibilità futura con stock_lots come sorgente di verità della quantità;
-- current_quantity resta, per ora, la colonna scritta direttamente dal codice applicativo
-- (inventory/postgres.ts) e quindi l'unica autorevole per la logica di business esistente.
-- -------------------------------------------------------------------------------------------
ALTER TABLE stock_items
  ADD COLUMN IF NOT EXISTS total_quantity numeric(18, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS earliest_expiry_at timestamptz;

-- -------------------------------------------------------------------------------------------
-- 2. stock_lots: posizione fisica per-lotto + colonna family_id denormalizzata
--
-- Sposta la relazione "posizione" dal singolo stock_item al singolo lotto: un prodotto può
-- avere lotti in dispensa E nel freezer sotto lo STESSO stock_item (family_id, product_id).
-- family_id è denormalizzato qui (mai scritto da capo, sempre copiato dal genitore) solo per
-- poter indicizzare/filtrare per famiglia senza continui JOIN su stock_items nella query calda
-- della dispensa.
-- -------------------------------------------------------------------------------------------
ALTER TABLE stock_lots
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS family_id uuid REFERENCES families(id);

-- Backfill: ogni lotto esistente eredita la posizione (e la famiglia) del proprio stock_item.
UPDATE stock_lots sl
SET location_id = si.location_id,
    family_id = si.family_id
FROM stock_items si
WHERE sl.stock_item_id = si.id
  AND sl.family_id IS DISTINCT FROM si.family_id;

-- Da qui in avanti family_id su stock_lots è obbligatorio (garantito dal trigger sotto per gli
-- insert futuri, così l'applicazione non deve ricordarsi di popolarlo esplicitamente).
CREATE OR REPLACE FUNCTION trg_stock_lots_default_family() RETURNS trigger AS $$
BEGIN
  IF NEW.family_id IS NULL THEN
    SELECT family_id INTO NEW.family_id FROM stock_items WHERE id = NEW.stock_item_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_lots_default_family_trg ON stock_lots;
CREATE TRIGGER stock_lots_default_family_trg
  BEFORE INSERT ON stock_lots
  FOR EACH ROW EXECUTE FUNCTION trg_stock_lots_default_family();

ALTER TABLE stock_lots ALTER COLUMN family_id SET NOT NULL;

-- -------------------------------------------------------------------------------------------
-- 3. Trigger di sincronizzazione stock_items.total_quantity / earliest_expiry_at
--
-- Ricalcola le due colonne denormalizzate dello stock_item interessato ad ogni INSERT/UPDATE/
-- DELETE su stock_lots. earliest_expiry_at considera solo i lotti con quantità residua > 0
-- (un lotto esaurito non deve più comparire come "prossima scadenza"). Gestisce esplicitamente
-- anche il caso raro di UPDATE che sposta un lotto da uno stock_item all'altro, ricalcolando
-- entrambe le righe coinvolte.
-- -------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_sync_stock_item_aggregates() RETURNS trigger AS $$
DECLARE
  affected_item_id uuid;
BEGIN
  affected_item_id := COALESCE(NEW.stock_item_id, OLD.stock_item_id);

  UPDATE stock_items s
  SET total_quantity = COALESCE(agg.total_qty, 0),
      earliest_expiry_at = agg.earliest_expiry
  FROM (
    SELECT
      COALESCE(SUM(COALESCE(quantity_snapshot, 0)), 0) AS total_qty,
      MIN(expires_at) FILTER (WHERE COALESCE(quantity_snapshot, 0) > 0) AS earliest_expiry
    FROM stock_lots
    WHERE stock_item_id = affected_item_id
  ) agg
  WHERE s.id = affected_item_id;

  IF TG_OP = 'UPDATE' AND OLD.stock_item_id IS DISTINCT FROM NEW.stock_item_id THEN
    UPDATE stock_items s
    SET total_quantity = COALESCE(agg.total_qty, 0),
        earliest_expiry_at = agg.earliest_expiry
    FROM (
      SELECT
        COALESCE(SUM(COALESCE(quantity_snapshot, 0)), 0) AS total_qty,
        MIN(expires_at) FILTER (WHERE COALESCE(quantity_snapshot, 0) > 0) AS earliest_expiry
      FROM stock_lots
      WHERE stock_item_id = OLD.stock_item_id
    ) agg
    WHERE s.id = OLD.stock_item_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_lots_sync_aggregates_ins ON stock_lots;
DROP TRIGGER IF EXISTS stock_lots_sync_aggregates_upd ON stock_lots;
DROP TRIGGER IF EXISTS stock_lots_sync_aggregates_del ON stock_lots;

CREATE TRIGGER stock_lots_sync_aggregates_ins
  AFTER INSERT ON stock_lots
  FOR EACH ROW EXECUTE FUNCTION trg_sync_stock_item_aggregates();

CREATE TRIGGER stock_lots_sync_aggregates_upd
  AFTER UPDATE OF quantity_snapshot, expires_at, stock_item_id ON stock_lots
  FOR EACH ROW EXECUTE FUNCTION trg_sync_stock_item_aggregates();

CREATE TRIGGER stock_lots_sync_aggregates_del
  AFTER DELETE ON stock_lots
  FOR EACH ROW EXECUTE FUNCTION trg_sync_stock_item_aggregates();

-- Backfill iniziale delle due colonne denormalizzate per tutte le righe già esistenti.
UPDATE stock_items s
SET total_quantity = COALESCE(agg.total_qty, 0),
    earliest_expiry_at = agg.earliest_expiry
FROM (
  SELECT
    stock_item_id,
    COALESCE(SUM(COALESCE(quantity_snapshot, 0)), 0) AS total_qty,
    MIN(expires_at) FILTER (WHERE COALESCE(quantity_snapshot, 0) > 0) AS earliest_expiry
  FROM stock_lots
  GROUP BY stock_item_id
) agg
WHERE agg.stock_item_id = s.id;

-- NOTA IMPORTANTE (documentata anche nel codice applicativo aggiornato, inventory/postgres.ts):
-- prima di questa migrazione, InventoryRepository.createStockItemAtomic creava un lotto in
-- stock_lots SOLO quando esisteva una data di scadenza (manuale o stimata) -- vedi
-- 0005_inventory-ledger.sql / 0014_shelf-life.sql. Uno stock_item creato senza scadenza aveva
-- quindi current_quantity valorizzato ma ZERO righe in stock_lots, quindi total_quantity
-- calcolato da questa migrazione risulterebbe 0 anche con merce realmente presente. Il codice
-- applicativo di questa stessa consegna corregge la causa (createStockItemAtomic ora inserisce
-- SEMPRE un lotto, con expires_at NULL se non c'è scadenza nota), così che da qui in avanti
-- total_quantity converga sempre a current_quantity. Per i dati storici già affetti dal gap,
-- questa migrazione applica una riparazione one-shot: dove non esiste ALCUN lotto per lo
-- stock_item, viene creato un lotto "di allineamento" con la quantità corrente e nessuna scadenza.
INSERT INTO stock_lots (stock_item_id, location_id, family_id, received_at, quantity_snapshot, expiry_source)
SELECT s.id, s.location_id, s.family_id, s.updated_at, s.current_quantity, 'MANUAL'
FROM stock_items s
WHERE s.status IN ('ACTIVE', 'DEPLETED')
  AND s.current_quantity > 0
  AND NOT EXISTS (SELECT 1 FROM stock_lots sl WHERE sl.stock_item_id = s.id);

-- Il backfill sopra ha aggiunto nuovi lotti: i trigger AFTER INSERT hanno già ricalcolato le
-- righe di stock_items toccate riga per riga, quindi non serve un secondo UPDATE aggregato qui.

-- -------------------------------------------------------------------------------------------
-- 4. Nuova chiave semantica: un solo stock_item ACTIVE per (family_id, product_id)
--
-- Aggiunta ACCANTO a stock_items_active_semantic_idx (0005/0016), non in sostituzione: questo è
-- lo step "expand". Il codice applicativo aggiornato in questa consegna scrive già rispettando
-- entrambi i vincoli (crea/riusa un solo stock_item per prodotto, registra la posizione sul
-- lotto). Il drop dell'indice legacy e delle colonne stock_items.location_id/package_id è
-- pianificato per la migrazione di "contract" successiva, a rollout completato.
-- -------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS stock_items_active_product_idx
  ON stock_items (family_id, product_id)
  WHERE status = 'ACTIVE';

-- -------------------------------------------------------------------------------------------
-- 5. stock_thresholds → integrata in stock_items
--
-- stock_items ha già reorder_point (0005_inventory-ledger.sql); l'unica cosa che
-- stock_thresholds aggiungeva era policy_version. Nessun modulo applicativo in the former core service
-- referenzia stock_thresholds oggi (verificato su inventory/*, shopping/*, shelf-life/*): la
-- tabella è dati morti. Aggiungiamo la colonna mancante su stock_items, portiamo dentro i dati
-- (per family+product, a prescindere dalla location visto che ora la posizione è per-lotto),
-- e sostituiamo la tabella con una VIEW con lo stesso nome/stessa shape a scopo di
-- compatibilità, così qualunque query esterna/report non ancora migrato continua a funzionare
-- in sola lettura fino al drop definitivo nella migrazione di contract.
-- -------------------------------------------------------------------------------------------
ALTER TABLE stock_items
  ADD COLUMN IF NOT EXISTS reorder_policy_version text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_thresholds' AND table_type = 'BASE TABLE') THEN
    UPDATE stock_items s
    SET reorder_point = COALESCE(s.reorder_point, t.reorder_point),
        reorder_policy_version = COALESCE(s.reorder_policy_version, t.policy_version)
    FROM (
      SELECT DISTINCT ON (family_id, product_id) family_id, product_id, reorder_point, policy_version
      FROM stock_thresholds
      ORDER BY family_id, product_id, updated_at DESC
    ) t
    WHERE s.family_id = t.family_id AND s.product_id = t.product_id AND s.status = 'ACTIVE';

    EXECUTE 'ALTER TABLE stock_thresholds RENAME TO stock_thresholds_deprecated_0017';
    EXECUTE $view$
      CREATE VIEW stock_thresholds AS
      SELECT
        gen_random_uuid() AS id,
        family_id,
        product_id,
        NULL::uuid AS location_id,
        reorder_point,
        COALESCE(reorder_policy_version, 'legacy') AS policy_version,
        updated_at
      FROM stock_items
      WHERE reorder_point IS NOT NULL
    $view$;
  END IF;
END $$;

-- -------------------------------------------------------------------------------------------
-- 6. shopping_item_sources → integrata in shopping_items
--
-- shopping_item_sources è invece attivamente scritta da ShoppingRepository.addItemAtomic
-- (services/shopping/postgres.ts) ad ogni creazione/merge di uno shopping_item: non è
-- rimovibile in questa fase senza modificare quel codice. La integriamo aggiungendo una colonna
-- jsonb `sources` su shopping_items che accumula lo stesso storico, mantenuta con un trigger che
-- specchia ogni INSERT su shopping_item_sources: il codice applicativo esistente continua a
-- scrivere sulla tabella storica SENZA modifiche e ottiene "gratis" l'array consolidato leggibile
-- in un'unica query (niente più join per la vista dettaglio dello shopping item). Il drop della
-- tabella storica è previsto nella migrazione di contract, una volta che addItemAtomic scriverà
-- direttamente su shopping_items.sources.
-- -------------------------------------------------------------------------------------------
ALTER TABLE shopping_items
  ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE shopping_items i
SET sources = COALESCE(agg.items, '[]'::jsonb)
FROM (
  SELECT
    item_id,
    jsonb_agg(
      jsonb_build_object(
        'sourceType', source_type,
        'sourceRef', source_ref,
        'reasonCode', reason_code,
        'createdAt', created_at
      ) ORDER BY created_at ASC
    ) AS items
  FROM shopping_item_sources
  GROUP BY item_id
) agg
WHERE agg.item_id = i.id;

CREATE OR REPLACE FUNCTION trg_mirror_shopping_item_source() RETURNS trigger AS $$
BEGIN
  UPDATE shopping_items
  SET sources = sources || jsonb_build_array(
    jsonb_build_object(
      'sourceType', NEW.source_type,
      'sourceRef', NEW.source_ref,
      'reasonCode', NEW.reason_code,
      'createdAt', NEW.created_at
    )
  )
  WHERE id = NEW.item_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shopping_item_sources_mirror_trg ON shopping_item_sources;
CREATE TRIGGER shopping_item_sources_mirror_trg
  AFTER INSERT ON shopping_item_sources
  FOR EACH ROW EXECUTE FUNCTION trg_mirror_shopping_item_source();

-- -------------------------------------------------------------------------------------------
-- 7. Nuove tabelle: negozi, prezzi, scontrini, preferenze di notifica
-- -------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid REFERENCES families(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  chain text,
  address text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stores_family_idx ON stores (family_id) WHERE family_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS store_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  product_id uuid NOT NULL REFERENCES products(id),
  price numeric(10, 2) NOT NULL CHECK (price >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (char_length(currency) = 3),
  unit_price numeric(10, 4),
  is_offer boolean NOT NULL DEFAULT false,
  offer_ends_at timestamptz,
  source text NOT NULL DEFAULT 'RECEIPT' CHECK (source IN ('RECEIPT', 'MANUAL', 'PROVIDER')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id),
  store_id uuid REFERENCES stores(id),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  object_key text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'PARSED', 'MANUAL_REQUIRED', 'FAILED')),
  ocr_job_id uuid,
  total_amount numeric(10, 2),
  currency text NOT NULL DEFAULT 'EUR' CHECK (char_length(currency) = 3),
  purchased_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS receipts_family_status_idx ON receipts (family_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES receipts(id),
  raw_description text NOT NULL,
  matched_product_id uuid REFERENCES products(id),
  match_confidence numeric(5, 4) CHECK (match_confidence IS NULL OR match_confidence BETWEEN 0 AND 1),
  quantity numeric(18, 6) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(10, 2),
  total_price numeric(10, 2) NOT NULL CHECK (total_price >= 0),
  stock_item_id uuid REFERENCES stock_items(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS receipt_items_receipt_idx ON receipt_items (receipt_id);
CREATE INDEX IF NOT EXISTS receipt_items_matched_product_idx
  ON receipt_items (matched_product_id) WHERE matched_product_id IS NOT NULL;

-- -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_notification_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  family_id uuid REFERENCES families(id),
  push_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  expiry_days_before integer NOT NULL DEFAULT 2 CHECK (expiry_days_before >= 0),
  reorder_enabled boolean NOT NULL DEFAULT true,
  offers_enabled boolean NOT NULL DEFAULT false,
  quiet_hours_start_utc integer CHECK (quiet_hours_start_utc IS NULL OR quiet_hours_start_utc BETWEEN 0 AND 23),
  quiet_hours_end_utc integer CHECK (quiet_hours_end_utc IS NULL OR quiet_hours_end_utc BETWEEN 0 AND 23),
  push_tokens jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------------------------------------
-- 8. Indici ad alte prestazioni
-- -------------------------------------------------------------------------------------------

-- Ricerca fuzzy per nome prodotto (ILIKE / similarity trigram) sulla vista dispensa.
CREATE INDEX IF NOT EXISTS products_canonical_name_trgm_idx
  ON products USING gin (canonical_name gin_trgm_ops);

-- Filtro/ordinamento della dispensa: per famiglia + stato, ordinata per scadenza più vicina.
CREATE INDEX IF NOT EXISTS stock_items_family_status_expiry_idx
  ON stock_items (family_id, status, earliest_expiry_at ASC NULLS LAST);

-- Copre anche l'ordinamento decrescente richiesto dal parametro sortDir=DESC del nuovo endpoint.
CREATE INDEX IF NOT EXISTS stock_items_family_status_expiry_desc_idx
  ON stock_items (family_id, status, earliest_expiry_at DESC NULLS LAST);

-- Filtro per locazione: "mostrami cosa ho nel freezer" ora interroga stock_lots.
CREATE INDEX IF NOT EXISTS stock_lots_location_idx
  ON stock_lots (location_id, stock_item_id) WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS stock_lots_stock_item_expiry_idx
  ON stock_lots (stock_item_id, expires_at ASC NULLS LAST);

CREATE INDEX IF NOT EXISTS stock_lots_family_idx ON stock_lots (family_id);

-- Vista spesa: filtro per lista + stato è la query più frequente della schermata Spesa.
CREATE INDEX IF NOT EXISTS shopping_items_list_state_idx
  ON shopping_items (list_id, state);

-- Prezzi negozio: "ultimo prezzo noto di questo prodotto in questo negozio" e trend nel tempo.
CREATE INDEX IF NOT EXISTS store_prices_product_store_observed_idx
  ON store_prices (product_id, store_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS store_prices_product_observed_idx
  ON store_prices (product_id, observed_at DESC);

COMMIT;

