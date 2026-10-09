# Ricette e suggerimenti

## Catalogo

Il servizio `service-recipes` importa la versione v4 dell'Italian gastronomic recipes dataset da Zenodo (DOI 10.5281/zenodo.14068000), con licenza CC BY 4.0.

Il dataset viene verificato con MD5 `b90427179a4304270fd5b7b7490b565d` prima dell'importazione.

I dati globali sono separati dalle ricette create dalle famiglie:

- `recipe_catalog.recipes`
- `recipe_catalog.recipe_ingredients`
- `recipe_catalog.recipe_steps`

Le ricette globali ricevono UUID deterministici derivati dall'ID del dataset, così l'import è ripetibile.

## Ricerca per nome

`GET /api/v1/recipes?familyId=<familyId>&q=<testo>`

Quando `q` è presente, la ricerca usa PostgreSQL trigram similarity e cerca nel catalogo globale italiano oltre alle ricette della famiglia.

La ricerca non carica tutte le ricette: usa l'indice GIN trigram sul titolo.

## Suggerimenti dalla dispensa

`GET /api/v1/recipes/suggestions?familyId=<familyId>&limit=20`

Il servizio:

1. recupera gli articoli correnti da Inventory;
2. normalizza italiano/inglese tramite alias degli ingredienti;
3. usa l'indice inverso sugli ingredienti per ottenere solo un insieme candidato;
4. calcola la copertura degli ingredienti disponibili;
5. premia gli ingredienti prossimi alla scadenza;
6. penalizza gli ingredienti mancanti;
7. ordina e restituisce solo il top-K.

Formula iniziale:

`score = 0.72 * coverage + 0.18 * expiryScore + 0.10 * shoppingScore`

La ricerca per nome invece privilegia la corrispondenza del titolo e usa la disponibilità solo come informazione secondaria.

## Limiti intenzionali

Il campo `Weight` del dataset rappresenta il peso dell'ingrediente nella composizione della ricetta, non necessariamente grammi utilizzabili per la spesa. Non viene quindi trasformato arbitrariamente in grammi.

Le colonne `Preparation` del dataset descrivono operazioni/preparazioni e non sono considerate istruzioni complete di cucina.

## Avvio

Il container del servizio esegue:

1. migrazioni;
2. import del dataset se non è già presente o se `RECIPE_DATASET_FORCE_REIMPORT=1`;
3. avvio HTTP.

Una volta importato, i riavvii successivi non riscaricano il dataset.

