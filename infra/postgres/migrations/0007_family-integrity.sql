ALTER TABLE locations
  ADD CONSTRAINT locations_id_family_unique UNIQUE (id, family_id);

ALTER TABLE stock_items
  DROP CONSTRAINT IF EXISTS stock_items_location_id_fkey;

ALTER TABLE stock_items
  ADD CONSTRAINT stock_items_location_family_fkey
  FOREIGN KEY (location_id, family_id) REFERENCES locations (id, family_id);

ALTER TABLE stock_items
  ADD CONSTRAINT stock_items_id_family_unique UNIQUE (id, family_id);

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_stock_item_id_fkey;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_item_family_fkey
  FOREIGN KEY (stock_item_id, family_id) REFERENCES stock_items (id, family_id);
