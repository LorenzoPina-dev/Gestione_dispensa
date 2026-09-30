-- Transitional database bootstrap. Legacy DBs remain until their services are migrated.
CREATE DATABASE users_db;
CREATE DATABASE families_db;
CREATE DATABASE products_db;
CREATE DATABASE barcode_db;
CREATE DATABASE inventory_db;
CREATE DATABASE expiration_db;
CREATE DATABASE shopping_db;
CREATE DATABASE stores_db;
CREATE DATABASE offers_db;
CREATE DATABASE recipes_db;
CREATE DATABASE nutrition_db;
CREATE DATABASE notifications_db;
CREATE DATABASE media_db;
CREATE DATABASE analytics_db;

CREATE DATABASE identity_db;
CREATE DATABASE family_db;
CREATE DATABASE catalog_db;
CREATE DATABASE jobs_db;
CREATE DATABASE privacy_db;
CREATE DATABASE shelf_life_db;
CREATE DATABASE ocr_db;

CREATE ROLE inventory LOGIN PASSWORD 'inventory';
GRANT ALL PRIVILEGES ON DATABASE inventory_db TO inventory;
ALTER DATABASE inventory_db OWNER TO inventory;
