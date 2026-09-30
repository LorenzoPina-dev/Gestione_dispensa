CREATE DATABASE identity_db;
CREATE DATABASE family_db;
CREATE DATABASE inventory_db;
CREATE DATABASE shopping_db;
CREATE DATABASE catalog_db;
CREATE DATABASE notifications_db;
CREATE DATABASE privacy_db;
CREATE DATABASE jobs_db;
CREATE DATABASE recipes_db;
CREATE DATABASE nutrition_db;
CREATE DATABASE stores_db;
CREATE DATABASE shelf_life_db;
CREATE DATABASE ocr_db;

CREATE ROLE inventory LOGIN PASSWORD 'inventory';
GRANT ALL PRIVILEGES ON DATABASE inventory_db TO inventory;
