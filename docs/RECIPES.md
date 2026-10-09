# Ricette e suggerimenti

## Import del catalogo

Il job Compose `recipes-catalog-import` importa il dataset Zenodo `14068000`. URL, MD5 atteso e chiavi `dataset_key`/`source` sono definite in `services/service-recipes/src/catalog-import.ts`; non confondere la chiave interna dataset (attualmente `italian-gastronomic-recipes-v8`) con il campo source assegnato ai record (`italian-gastronomic-recipes-v5`). L'import controlla MD5 e usa ID deterministici per i record. La verifica della versione importata è salvata in `recipe_catalog.datasets`; `RECIPE_DATASET_FORCE_REIMPORT=1` forza il job. Compose esegue lo schema migrate come job separato, poi l'import va invocato tramite `recipes-catalog-import`.

Le tabelle del catalogo globale (`recipe_catalog.*`) sono distinte dalle ricette utente (`recipes_domain.*`). Le migration sono in `services/service-recipes/migrations`.

## API e suggerimenti

`GET /api/v1/recipes?familyId=...&q=...` cerca le ricette; `GET /api/v1/recipes/suggestions?familyId=...` restituisce suggerimenti basati sugli ingredienti recuperati da Inventory e sulla risoluzione delle identità alimentari. La risposta include disponibilità/mancanti secondo il matching del servizio. `POST /api/v1/recipes/:recipeId/add-missing` crea o aggiorna gli articoli mancanti in Shopping.

La strategia di matching e le soglie devono restare coerenti con `pantry-recipe-engine.ts`, `recipe-match.ts` e Food Semantics. I termini tradotti e gli alias sono evidenza per la risoluzione; la traduzione letterale da sola non basta a provare equivalenza fra prodotti. Non introdurre mappe ingredienti hard-coded nel codice: identità e label appartengono al servizio semantico.

## Nutrienti e quantità

Nutrition possiede target, diario e riepilogo tramite le proprie API. Il modello `Weight` del dataset è un peso compositivo e non equivale necessariamente alla quantità acquistabile/consumabile. Le colonne di preparazione non sono istruzioni di cucina complete.

Nel codice verificato non è presente una route di completamento ricetta che scala le porzioni, consuma automaticamente Inventory e crea una voce Nutrition. Il catalogo ricetta, l'aggiunta alla spesa e l'inserimento nel diario sono capacità distinte.

Per la sequenza dei servizi, vedi [flusso ricette](DIAGRAMS.md#ricette-disponibilità-e-completamento) e lo schema di [recipes_db](DIAGRAMS.md#database-e-storage).
