BEGIN;
CREATE SCHEMA IF NOT EXISTS recipes_domain;
CREATE SCHEMA IF NOT EXISTS nutrition_domain;
CREATE SCHEMA IF NOT EXISTS stores_domain;
CREATE SCHEMA IF NOT EXISTS shelf_life_domain;
CREATE SCHEMA IF NOT EXISTS ocr_domain;

CREATE TABLE IF NOT EXISTS recipes_domain.recipes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid REFERENCES public.families(id) ON DELETE CASCADE,
 title text NOT NULL, description text, servings integer NOT NULL DEFAULT 1 CHECK(servings>0),
 prep_time_min integer NOT NULL DEFAULT 0 CHECK(prep_time_min>=0), cook_time_min integer NOT NULL DEFAULT 0 CHECK(cook_time_min>=0),
 difficulty text NOT NULL DEFAULT 'MEDIUM', image_url text, is_custom boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS recipes_domain.recipe_ingredients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipe_id uuid NOT NULL REFERENCES recipes_domain.recipes(id) ON DELETE CASCADE,
 product_id uuid REFERENCES public.products(id) ON DELETE SET NULL, display_name text NOT NULL, amount numeric(18,6) NOT NULL CHECK(amount>0), unit text NOT NULL, position integer NOT NULL DEFAULT 0, allergens text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS recipes_domain_family_idx ON recipes_domain.recipes(family_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS recipes_domain_ingredients_idx ON recipes_domain.recipe_ingredients(recipe_id,position);
ALTER TABLE recipes_domain.recipe_ingredients ADD COLUMN IF NOT EXISTS allergens text[] NOT NULL DEFAULT '{}';

-- One-time compatibility import: the previous monolith owned these tables in public. The new
-- services own their domain schemas, while public remains authoritative for core inventory/users.
INSERT INTO recipes_domain.recipes(id,title,description,servings,prep_time_min,cook_time_min,difficulty,image_url,is_custom,status,created_at)
SELECT r.id,r.title,r.source,r.servings,COALESCE(r.time_minutes,0),0,r.difficulty,r.image,true,r.status,r.created_at
FROM public.recipes r
ON CONFLICT(id) DO NOTHING;
INSERT INTO recipes_domain.recipe_ingredients(id,recipe_id,product_id,display_name,amount,unit,position)
SELECT i.id,i.recipe_id,i.product_id,i.display_name,i.amount,i.unit,i.position
FROM public.recipe_ingredients i
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS nutrition_domain.nutrition_targets (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE, daily_calories integer NOT NULL DEFAULT 2000,
 protein_grams numeric(8,2) NOT NULL DEFAULT 150, carbs_grams numeric(8,2) NOT NULL DEFAULT 200, fat_grams numeric(8,2) NOT NULL DEFAULT 65,
 diet_type text NOT NULL DEFAULT 'STANDARD', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS nutrition_domain.nutrition_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 family_id uuid REFERENCES public.families(id) ON DELETE CASCADE, log_date date NOT NULL DEFAULT current_date,
 source_type text NOT NULL CHECK(source_type IN ('STOCK_CONSUMED','RECIPE_COOKED','MANUAL')), source_ref text,
 calories numeric(10,2) NOT NULL DEFAULT 0, protein_grams numeric(10,2) NOT NULL DEFAULT 0, carbs_grams numeric(10,2) NOT NULL DEFAULT 0,
 fat_grams numeric(10,2) NOT NULL DEFAULT 0, fiber_grams numeric(10,2) NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nutrition_domain_logs_user_date_idx ON nutrition_domain.nutrition_logs(user_id,log_date DESC);
CREATE INDEX IF NOT EXISTS nutrition_domain_logs_family_date_idx ON nutrition_domain.nutrition_logs(family_id,log_date DESC);

CREATE TABLE IF NOT EXISTS stores_domain.stores (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
 name text NOT NULL, chain text, address text, latitude numeric(9,6), longitude numeric(9,6), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stores_domain.store_prices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES stores_domain.stores(id) ON DELETE CASCADE,
 product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE, price numeric(10,2) NOT NULL CHECK(price>=0), currency char(3) NOT NULL DEFAULT 'EUR',
 unit_price numeric(10,4), is_offer boolean NOT NULL DEFAULT false, offer_ends_at timestamptz,
 source text NOT NULL DEFAULT 'RECEIPT' CHECK(source IN ('RECEIPT','MANUAL','PROVIDER')), observed_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stores_domain_prices_lookup_idx ON stores_domain.store_prices(product_id,store_id,observed_at DESC);

INSERT INTO stores_domain.stores(id,family_id,name,chain,address,latitude,longitude,status,created_at,updated_at)
SELECT id,family_id,name,chain,address,latitude,longitude,status,created_at,updated_at
FROM public.stores
ON CONFLICT(id) DO NOTHING;
INSERT INTO stores_domain.store_prices(id,store_id,product_id,price,currency,unit_price,is_offer,offer_ends_at,source,observed_at,created_at)
SELECT id,store_id,product_id,price,currency,unit_price,is_offer,offer_ends_at,source,observed_at,created_at
FROM public.store_prices
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS shelf_life_domain.rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category text NOT NULL, storage_kind text NOT NULL CHECK(storage_kind IN ('PANTRY','FRIDGE','FREEZER','CELLAR','OTHER')),
 estimated_days integer CHECK(estimated_days IS NULL OR estimated_days>0), notify_days_before integer NOT NULL DEFAULT 2 CHECK(notify_days_before>=0),
 source text NOT NULL DEFAULT 'FOODKEEPER', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(category,storage_kind)
);
INSERT INTO shelf_life_domain.rules(category,storage_kind,estimated_days,notify_days_before,source) VALUES
('fresh-meat-fish','FRIDGE',2,1,'FOODKEEPER'),('fresh-meat-fish','FREEZER',90,7,'FOODKEEPER'),('fresh-milk-pasta','FRIDGE',5,1,'FOODKEEPER'),
('cold-cuts-fresh-cheese','FRIDGE',6,2,'EFSA'),('eggs-dairy','FRIDGE',17,3,'EFSA'),('produce-fresh','FRIDGE',7,2,'EFSA'),('produce-fresh','PANTRY',4,1,'EFSA'),
('bakery-fresh','PANTRY',3,1,'EFSA'),('bakery-fresh','FREEZER',60,5,'EFSA'),('canned-preserved','PANTRY',540,14,'FOODKEEPER'),
('dry-staples','PANTRY',630,14,'FOODKEEPER'),('frozen-general','FREEZER',180,10,'FOODKEEPER'),('pantry-indefinite','PANTRY',NULL,0,'FOODKEEPER'),
('__default__','FRIDGE',7,2,'FOODKEEPER'),('__default__','FREEZER',180,10,'FOODKEEPER'),('__default__','PANTRY',365,14,'FOODKEEPER'),('__default__','CELLAR',365,14,'FOODKEEPER'),('__default__','OTHER',30,5,'FOODKEEPER')
ON CONFLICT(category,storage_kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS ocr_domain.jobs (
 id uuid PRIMARY KEY, family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE, uploaded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 store_id uuid REFERENCES stores_domain.stores(id) ON DELETE SET NULL, object_key text NOT NULL, mime_type text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','NEEDS_REVIEW','CONFIRMED','FAILED')),
 idempotency_key text NOT NULL UNIQUE, failure_reason text, confirmation_payload jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz
);
CREATE TABLE IF NOT EXISTS ocr_domain.drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES ocr_domain.jobs(id) ON DELETE CASCADE,
 raw_text text NOT NULL, matched_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL, suggested_name text, quantity numeric(18,6), unit text,
 confidence numeric(5,4), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ocr_domain_jobs_family_idx ON ocr_domain.jobs(family_id,created_at DESC);

INSERT INTO public.schema_migrations(version,name,checksum) VALUES('0018-domain-microservices','domain-microservices','manual') ON CONFLICT(version) DO NOTHING;
COMMIT;
