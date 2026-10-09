# Matching dispensa e ricette

## Responsabilità

- Inventory possiede articoli, quantità, lotti e movimenti correnti.
- Catalog possiede i prodotti applicativi e le proiezioni semantiche del prodotto.
- Food Semantics possiede le identità alimentari, labels, relazioni e mapping.
- Recipes possiede catalogo ricette, ingredienti, suggerimenti e calcolo della disponibilità.

I collegamenti tra questi contesti avvengono attraverso API e identità prodotto/alimento; i servizi non leggono le tabelle altrui.

## Matching

Per costruire suggerimenti, Recipes recupera lo stato dispensa da Inventory e confronta gli ingredienti della ricetta attraverso le identità/termini alimentari disponibili. La risoluzione tiene conto della normalizzazione del testo e delle informazioni Food Semantics; i termini multilingua aiutano la ricerca ma una traduzione letterale non equivale automaticamente a una corrispondenza certa.

La risposta distingue disponibilità e ingredienti mancanti e viene ordinata dal motore Recipes. `POST /api/v1/recipes/:recipeId/add-missing` trasferisce gli ingredienti mancanti a Shopping. Vedere [RECIPES.md](RECIPES.md) per import e API e [DIAGRAMS.md](DIAGRAMS.md#ricette-disponibilità-e-completamento) per il flusso.

## Limiti dello stato corrente

Nel branch `main` verificato il servizio non espone una route che, al completamento della ricetta, riduce automaticamente la dispensa secondo porzioni e quantità e registra l'apporto in Nutrition. Nutrition espone API separate per target, inserimento/lettura diario e riepilogo.

Gli ingredienti senza quantità misurabile (come `q.b.`) non vanno convertiti in un consumo inventato. Per i dettagli implementativi aggiornati fanno fede `pantry-recipe-engine.ts`, `recipe-match.ts`, `recipe-ingredient-model.ts` e le route del servizio.
