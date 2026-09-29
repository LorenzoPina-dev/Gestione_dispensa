BEGIN;

-- Runtime roles used by the domain services and background workers.
-- RLS remains the tenant boundary; these grants only provide SQL object access.
GRANT USAGE ON SCHEMA public, nutrition_domain, ocr_domain, recipes_domain, shelf_life_domain, stores_domain
  TO dispensa_app, dispensa_worker;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public, nutrition_domain, ocr_domain, recipes_domain, shelf_life_domain, stores_domain
  TO dispensa_app, dispensa_worker;

GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA public, nutrition_domain, ocr_domain, recipes_domain, shelf_life_domain, stores_domain
  TO dispensa_app, dispensa_worker;

-- Future migrations create objects as the migration owner (dispensa).
ALTER DEFAULT PRIVILEGES FOR ROLE dispensa IN SCHEMA public, nutrition_domain, ocr_domain, recipes_domain, shelf_life_domain, stores_domain
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dispensa_app, dispensa_worker;

ALTER DEFAULT PRIVILEGES FOR ROLE dispensa IN SCHEMA public, nutrition_domain, ocr_domain, recipes_domain, shelf_life_domain, stores_domain
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dispensa_app, dispensa_worker;

COMMIT;
