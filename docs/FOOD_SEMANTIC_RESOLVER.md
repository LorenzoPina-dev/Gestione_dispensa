# Food Semantic Resolver

## Purpose

`service-food-semantics` is the single source of truth for food identity, aliases, ontology labels and recipe/pantry semantic resolution.

The application code does not contain ingredient translation dictionaries, food alias maps, taxonomy-to-canonical maps, parent food maps or functional-substitution tables.

## Data sources

### FoodOn

FoodOn is imported into the resolver database as the base food ontology. The importer stores:
- stable source identifier;
- preferred labels;
- synonyms;
- parent `IS_A` relationships;
- source version and checksum;
- provenance and license metadata.

The bootstrap source is configurable through `FOOD_ONTOLOGY_URL`, `FOOD_ONTOLOGY_VERSION` and `FOOD_ONTOLOGY_SOURCE_KEY`.
The default source is the FoodOn OBO vocabulary. FoodOn is CC BY 4.0.

### Translation backend

FoodOn is an ontology, not a universal multilingual translation dictionary. The resolver therefore uses a self-hosted translation backend through `TRANSLATION_BASE_URL`.
The Compose stack provides LibreTranslate with English, Italian, French, Spanish and German models.

No ingredient-specific translation is stored in TypeScript.

### Open Food Facts

Open Food Facts remains the product-data source through the existing `off-lookup`/catalog pipeline. The catalog sends product names, multilingual names, ingredient texts and taxonomy tags to the resolver.

The resolver stores only the semantic product mapping, not a second copy of the OFF product database.

## Runtime identity

A resolved ingredient receives a stable identity such as `foodon:FOODON_...`.
Recipe ingredients and pantry products match on this identifier rather than on localized strings.
Localized UI labels are returned as `displayName`.

## Resolution order

1. exact label/synonym in requested source language;
2. translation to the ontology language;
3. exact ontology label/synonym lookup;
4. localized display-name translation;
5. persisted semantic mapping/cache;
6. unresolved/ambiguous result when confidence is insufficient.

The resolver never invents a food identity from a fuzzy string merely because it looks similar.

## Ownership

`service-food-semantics` owns:
- `food_semantics.entities`;
- `food_semantics.labels`;
- `food_semantics.relations`;
- `food_semantics.product_mappings`;
- `food_semantics.resolution_cache`;
- `food_semantics.ontology_sources`.

Catalog and recipes keep projections/references to the resolved identity but do not own the ontology.

## Versioning

Every ontology import records source, source URL, source version, checksum, entity count, label count and import timestamp.

## Migration path

The old `food-rules` ingredient dictionaries have been removed. `food-rules` remains responsible for generic quantity parsing and mechanical food-text parsing; food identity is now resolved by `service-food-semantics`.

The remaining food-specific quantity-density rules are operational conversion rules and should be migrated to resolver-owned data in a later migration if density becomes part of the semantic ontology.
