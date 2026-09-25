-- Shelf-life estimation: lets the API pre-fill stock_lots.expires_at when a stock item is
-- created without an explicit expiry, and lets a periodic scan warn a family before something
-- goes off. Design follows docs/GAP-ANALYSIS.md §4 ("scadenze, FIFO/FEFO e notifiche
-- configurabili") and packages the three sourcing channels described alongside it (Open Food
-- Facts category mapping, USDA FoodKeeper / EFSA reference tables, LLM fallback for the
-- long tail) behind one lookup table keyed by a canonical `category` string.
--
-- `category` here uses the SAME canonical vocabulary that
-- services/worker-integrations/src/providers/open-food-facts-provider.ts derives from OFF's
-- `categories_tags`, and that apps/api/src/catalog persists onto products.category -- so a
-- barcode-scanned product and a manually-picked category both resolve through this one table.
-- The special category '__default__' is the fallback used when a product has no category (or an
-- unrecognized one) for a given storage location.

CREATE TABLE IF NOT EXISTS shelf_life_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  storage_kind text NOT NULL CHECK (storage_kind IN ('PANTRY', 'FRIDGE', 'FREEZER', 'CELLAR', 'OTHER')),
  -- NULL means "this category is effectively non-perishable at this storage kind": no expiry is
  -- estimated and no notification is ever scheduled (e.g. salt, sugar, honey in the pantry).
  estimated_days integer CHECK (estimated_days IS NULL OR estimated_days > 0),
  notify_days_before integer NOT NULL DEFAULT 2 CHECK (notify_days_before >= 0),
  source_id uuid NOT NULL REFERENCES data_sources(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, storage_kind)
);

CREATE INDEX IF NOT EXISTS shelf_life_rules_lookup_idx ON shelf_life_rules (category, storage_kind);

-- Tracks which lot an EXPIRY notification has already been raised for, so the periodic scan
-- (apps/api/src/shelf-life/expiry-scan.ts) never double-notifies the same lot on every tick.
ALTER TABLE stock_lots
  ADD COLUMN IF NOT EXISTS expiry_notified_at timestamptz;

-- Distinguishes a user-entered expiry from one this system estimated, so the UI can label it
-- accordingly ("stimata" vs "inserita") and a user override always takes precedence going forward.
ALTER TABLE stock_lots
  ADD COLUMN IF NOT EXISTS expiry_source text NOT NULL DEFAULT 'MANUAL'
    CHECK (expiry_source IN ('MANUAL', 'ESTIMATED'));

-- Widen the notifications category CHECK to add EXPIRY (see apps/api/src/notifications/service.ts
-- NotificationService.notifyExpiringStock and services/worker-notifications for delivery).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_category_check CHECK (category IN ('REORDER', 'INVITE', 'SYSTEM', 'EXPIRY'));

-- Reference sources, following the same data_sources bookkeeping already used for Open Food
-- Facts imports (see 0004_catalog-foundation.sql / catalog/postgres.ts ensureSource).
INSERT INTO data_sources (kind, name, reliability_class)
VALUES
  ('IMPORT', 'usda-foodkeeper', 'TRUSTED'),
  ('IMPORT', 'efsa-ministero-salute', 'TRUSTED')
ON CONFLICT DO NOTHING;

-- Seed rules, derived from USDA FoodKeeper / EFSA-style shelf-life guidance. Values are
-- deliberately conservative estimates from the moment of purchase, not from packaging date.
WITH sources AS (
  SELECT
    (SELECT id FROM data_sources WHERE kind = 'IMPORT' AND name = 'usda-foodkeeper') AS foodkeeper,
    (SELECT id FROM data_sources WHERE kind = 'IMPORT' AND name = 'efsa-ministero-salute') AS efsa
)
INSERT INTO shelf_life_rules (category, storage_kind, estimated_days, notify_days_before, source_id)
SELECT * FROM (
  VALUES
    -- Carne macinata / pesce fresco: 1-2 giorni frigo
    ('fresh-meat-fish',        'FRIDGE',  2,   1, (SELECT foodkeeper FROM sources)),
    ('fresh-meat-fish',        'FREEZER', 90,  7, (SELECT foodkeeper FROM sources)),
    -- Latte fresco / pasta fresca: 4-6 giorni frigo
    ('fresh-milk-pasta',       'FRIDGE',  5,   1, (SELECT foodkeeper FROM sources)),
    -- Affettati in vaschetta / formaggi freschi: 5-7 giorni frigo
    ('cold-cuts-fresh-cheese', 'FRIDGE',  6,   2, (SELECT efsa FROM sources)),
    -- Uova / burro / yogurt: 14-20 giorni frigo
    ('eggs-dairy',             'FRIDGE',  17,  3, (SELECT efsa FROM sources)),
    -- Frutta e verdura fresca
    ('produce-fresh',          'FRIDGE',  7,   2, (SELECT efsa FROM sources)),
    ('produce-fresh',          'PANTRY',  4,   1, (SELECT efsa FROM sources)),
    -- Pane e prodotti da forno freschi
    ('bakery-fresh',           'PANTRY',  3,   1, (SELECT efsa FROM sources)),
    ('bakery-fresh',           'FREEZER', 60,  5, (SELECT efsa FROM sources)),
    -- Passata di pomodoro / conserve (lattina o vetro): 12-24 mesi dispensa
    ('canned-preserved',       'PANTRY',  540, 14, (SELECT foodkeeper FROM sources)),
    -- Pasta secca / riso / legumi secchi: 18-24 mesi dispensa
    ('dry-staples',            'PANTRY',  630, 14, (SELECT foodkeeper FROM sources)),
    -- Surgelati generici
    ('frozen-general',         'FREEZER', 180, 10, (SELECT foodkeeper FROM sources)),
    -- Sale / zucchero / miele: nessuna scadenza tracciata
    ('pantry-indefinite',      'PANTRY',  NULL, 0, (SELECT foodkeeper FROM sources)),
    -- Fallback per categoria sconosciuta o assente, per posizione di conservazione
    ('__default__',            'FRIDGE',  7,   2, (SELECT foodkeeper FROM sources)),
    ('__default__',            'FREEZER', 180, 10, (SELECT foodkeeper FROM sources)),
    ('__default__',            'PANTRY',  365, 14, (SELECT foodkeeper FROM sources)),
    ('__default__',            'CELLAR',  365, 14, (SELECT foodkeeper FROM sources)),
    ('__default__',            'OTHER',   30,  5, (SELECT foodkeeper FROM sources))
) AS seed(category, storage_kind, estimated_days, notify_days_before, source_id)
ON CONFLICT (category, storage_kind) DO NOTHING;
