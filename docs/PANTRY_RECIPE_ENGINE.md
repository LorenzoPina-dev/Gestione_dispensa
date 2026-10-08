# Pantry-to-Recipe Engine

## Stato implementazione — 2026-10-08

### COMPLETATO

- [x] Separazione delle responsabilità: Inventory mantiene stock/quantità/scadenze; Catalog mantiene identità e fatti del prodotto; Recipes calcola matching, copertura e sicurezza.
- [x] Modello `product_food_semantics` nel database Catalog con materializzazione atomica, versione delle regole e backfill one-shot.
- [x] Derivatore deterministico `food-semantics.ts` a partire dal dato OFF già curato nel Catalog.
- [x] Normalizzazione di accenti, maiuscole, separatori e prefissi lingua dei tag OFF.
- [x] Alias multilingua per gli ingredienti principali italiano/inglese/francese/spagnolo/tedesco e varianti singolare/plurale.
- [x] Mappatura iniziale taxonomy/tag -> ingrediente canonico.
- [x] Regole alimentari condivise in `packages/food-rules`: canonicalizzazione, termini semantici, peso culinario, allergeni e unità.
- [x] Conservazione distinta di `ingredientTerms`, `taxonomyTags`, `allergenTags`, `traceTags` e `labelTags`.
- [x] Correzione del significato dei dati: gli allergeni sono fatti sul prodotto; le etichette dietetiche sono fatti separati e non vengono inferiti automaticamente dagli allergeni.
- [x] Prima classificazione culinaria `STAPLE`, `SECONDARY`, `CORE`.
- [x] Stato semantico esplicito `EXACT|INFERRED|UNKNOWN|AMBIGUOUS` e confidenza persistita.
- [x] Normalizzazione delle quantità di confezione in base comuni `g`, `ml`, `piece`.
- [x] Parsing di quantità OFF espresse come testo, ad esempio `180 g`, quando il provider non espone già valore/unità separati.
- [x] Confidenza separata per semantica e quantità.
- [x] Esposizione del profilo semantico nel batch Catalog usato da Recipes.
- [x] Separazione tra identità commerciale del prodotto e composizione: ingredients_text non può cambiare arbitrariamente l'ingrediente canonico principale.
- [x] Parsing iniziale dei componenti di prodotti composti da ingredients_text, con percentuali, canonicalizzazione e compositionConfidence.
- [x] Canonicalizzazione degli allergeni/tracce OFF verso codici stabili.
- [x] Inferenza testuale multilingua degli allergeni quando `ingredients_text` o termini semantici contengono un allergene noto.
- [x] Matching Recipes basato su nome + identità canonica + termini semantici + tassonomia, invece del solo nome commerciale.
- [x] Nuovo modello semantico per `recipe_catalog.recipe_ingredients` e `recipes_domain.recipe_ingredients`.
- [x] Canonicalizzazione degli ingredienti delle ricette con quantità normalizzate, dimensione fisica, unità base, confidenza e stato di preparazione.
- [x] `Weight` del dataset mantenuto come peso compositivo della ricetta e separato dalle quantità di dispensa: non viene trattato come grammi.
- [x] Quantity engine con massa, volume e conteggio; conversioni soltanto entro la stessa dimensione.
- [x] Conversione confezione -> contenuto solo quando la quantità della confezione è nota esplicitamente.
- [x] Gestione di frazioni comuni, decimali con virgola e unità da cucina comuni.
- [x] Inferenza conservativa di conteggi impliciti per ingredienti whitelisted, ad esempio `2 uova`, con confidenza distinta.
- [x] Stati di copertura distinti: `COMPLETE`, `PARTIAL`, `MISSING`, `PRESENCE_ONLY`, `INCOMPATIBLE`.
- [x] Aggregazione di più righe della stessa identità culinaria prima dello scoring.
- [x] Score ponderato secondo `STAPLE=0.1`, `SECONDARY=0.5`, `CORE=1.0`.
- [x] Soglie di readiness: `>=0.80 READY`, `0.50-0.79 MINIMAL_SHOPPING`, `<0.50 DISCARD`.
- [x] Conteggio separato dei CORE mancanti per il ranking.
- [x] Sostituzioni funzionali curate con fattore 0.8: lo stock esatto viene utilizzato prima, il sostituto copre solo l'eventuale residuo.
- [x] Confidenza semantica persistita sugli ingredienti di ricetta; un canonical match debole non viene considerato identità certa.
- [x] Ranking secondario per numero di CORE mancanti, Nutri-Score dei prodotti di dispensa disponibili quando presente e tempo di preparazione.
- [x] Il Nutri-Score è trattato come tie-breaker ingredient-level e non viene spacciato per Nutri-Score della ricetta.
- [x] Il prodotto Catalog materializza `nutriscore_grade` separatamente dalla food identity.
- [x] Profilo alimentare personale in Identity con allergeni, restrizioni dietetiche e policy sulle tracce, versionato con ETag.
- [x] Filtro di sicurezza Recipes: allergene noto -> `BLOCK`; traccia -> `WARN` o `BLOCK` secondo policy; restrizione dietetica incompatibile -> `BLOCK`.
- [x] Stato `UNKNOWN_COMPOSITION` quando la composizione non è sufficientemente normalizzata; con un profilo di sicurezza attivo il comportamento è fail-closed (`BLOCK`).
- [x] Gateway già compatibile con il nuovo endpoint Identity tramite la rotta generalizzata `/api/v1/identity`.
- [x] Test deterministici aggiunti per quantity engine, copertura ponderata, conversione confezioni, unità incompatibili, allergeni, tracce, profili vegetariano/pescetariano e normalizzazione del profilo.
- [x] Correzione del parser delle istruzioni: le sezioni `HowToSection` vengono espanse nei relativi `itemListElement`, evitando output come `Boiling / Browning / Mixing` quando sono solo titoli di sezione.
- [x] Correzione della regressione TSX di `Ricette.tsx`.

### IN IMPLEMENTAZIONE / MANCANTE

- [ ] Estendere il parsing di `ingredients_text` a strutture annidate, separatori/localizzazioni ulteriori e quantità integrate complesse; è già presente un parser conservativo multilingua di base.
- [ ] Estendere `food_components[]` con ruoli culinari, percentuali affidabili, annidamento e provenance per componente; la prima proiezione di componenti, percentuali e `compositionConfidence` è già presente.
- [x] Mapping recipe ingredient -> canonical ingredient con una prima gerarchia alimentare direzionale: specifico -> generico è ammesso solo quando richiesto dalla ricetta.
- [ ] Densità e conversioni massa<->volume solo quando esiste una regola/dato affidabile e versionato per quello specifico ingrediente.
- [x] Modello iniziale di quantità usabile per confezioni aperte: `remainingContentQuantity/unit` esplicito in Inventory; una confezione aperta senza residuo misurato non contribuisce alla copertura quantitativa.
- [x] Priorità del residuo misurato sul contenuto commerciale originale quando una confezione è aperta.
- [ ] Estendere quantità usabile a porzioni, sfridi, resa post-apertura, densità e residui non misurati.
- [x] Sostituzioni semantiche/funzionali curate con fattore `0.8 * peso originale`, motivazione e tracciamento dei prodotti usati.
- [x] Profilo famigliare: Recipes legge i membri da Family e aggrega i profili personali da Identity; allergeni/restrizioni si uniscono e una policy tracce `EXCLUDE` prevale.
- [x] Policy separate per allergeni dichiarati e tracce; le frasi testuali di contaminazione vengono classificate distintamente.
- [x] Rendere configurabile la policy per incertezza a livello di profilo: `uncertaintyPolicy=WARN|EXCLUDE`, con default `EXCLUDE`.
- [ ] Calcolo nutrizionale reale per porzione e ranking recipe-level; è presente solo il tie-breaker ingredient-level basato sui Nutri-Score dei prodotti di dispensa.
- [x] `RecipeMatch` stabile con prodotti usati, quantità, mancanti, sostituzioni, istruzioni, sicurezza, copertura e spiegazione dello score. La nutrizione recipe-level resta separata perché il dataset non fornisce dati sufficienti.
- [x] Cache/materializzazione del profilo semantico nel Catalog con upsert atomico su create/update/import/refresh, funzione SQL di lettura, backfill one-shot e fallback quando la `rulesVersion` cambia.
- [x] Versionamento esplicito di `rulesVersion` nella proiezione semantica; resta da propagare la versione delle regole nel risultato storico completo di `RecipeMatch`.
- [ ] Import del catalogo ricette spostato da startup di `service-recipes` a job/worker one-shot: il servizio applicativo non deve dipendere dalla disponibilità di Zenodo.
- [ ] Test matrix ampia con prodotti multilingua, quantità senza unità, confezioni, duplicati, dati OFF parziali, ingredienti composti e collisioni semantiche.
- [ ] Validazione/build completa in ambiente Docker. In questa sessione il repository non era clonabile dal runtime per un errore DNS verso GitHub, quindi i test aggiunti non sono stati dichiarati come eseguiti.
- [x] Fallback controllati quando mancano dati: nessuna invenzione di ingredienti; il matcher evita generalizzazioni non sicure e usa stati `UNKNOWN`/`AMBIGUOUS` dove appropriato.
- [ ] Ampliare i fallback su ingredienti testuali multi-frase e composizioni annidate.
- [x] Comportamento fail-closed per `UNKNOWN_COMPOSITION` quando esistono allergeni o restrizioni attive; la policy configurabile per singolo profilo è ancora aperta.

## Contratto concettuale

Ogni prodotto di dispensa deve poter esporre due livelli distinti:

1. **Commercial identity**: prodotto reale, brand, barcode, confezione, immagini, nutrizione e dati OFF.
2. **Food identity**: ingrediente canonico, termini semantici, tassonomia, allergeni, tracce, etichette dietetiche, peso culinario e confidenza.

La seconda rappresentazione è una proiezione; non sostituisce il prodotto reale e non viene duplicata nell'Inventory.

Ogni ingrediente di ricetta deve esporre a sua volta:

- identità canonica e termini;
- quantità originale quando disponibile;
- quantità normalizzata e dimensione;
- confidenza della quantità;
- peso culinario;
- stato di preparazione;
- eventuale informazione di composizione.

Il matching segue quindi una sequenza deterministica:

`commercial product -> food identity -> recipe ingredient identity -> quantity coverage -> substitutions -> safety -> ranking`

La sicurezza viene valutata prima del ranking finale: un risultato con allergene incompatibile non viene “salvato” da un punteggio dispensa elevato.

## Decisioni architetturali

1. Un prodotto commerciale non viene considerato direttamente un ingrediente solo perché il nome contiene una parola simile.
2. L'identità culinaria è una proiezione derivata dal Catalog/OFF e ha sempre una confidenza.
3. `Inventory` non conosce sinonimi, allergeni o tassonomie.
4. `Recipes` non dipende dal dump MongoDB OFF: riceve dal Catalog una rappresentazione canonica stabile.
5. Un dato assente non viene trasformato in un fatto: viene mantenuta l'incertezza.
6. Gli allergeni sono un filtro di sicurezza, non un semplice fattore di ranking.
7. Le conversioni di quantità sono separate dal matching semantico: “che ingrediente è?” e “quanto ne ho?” sono problemi diversi.
8. Massa e volume non vengono convertiti senza una regola di densità affidabile.
9. Le preferenze personali appartengono a Identity; Catalog espone solo fatti del prodotto.
10. Le tracce non sono equiparate automaticamente agli allergeni dichiarati.
11. Il campo `Weight` del dataset ricette non viene riutilizzato come quantità fisica della dispensa.

## Prossimo incremento

Il blocco successivo deve completare la semantica dei dati incompleti: parsing più ricco di `ingredients_text`, componenti annidati, stati `UNKNOWN/AMBIGUOUS` e gerarchie ingredientali. Subito dopo va chiuso il RecipeMatch definitivo, l'aggregazione famigliare delle policy di sicurezza e il ranking nutrizionale.


### Operatività del catalogo ricette

`service-recipes` non scarica più il dataset Zenodo durante l'avvio applicativo.

`recipes-schema-migrate` applica le migration di Recipes come job one-shot.
`recipes-catalog-import` aggiorna il catalogo globale dopo la migration e può fallire senza impedire l'avvio del servizio applicativo.
`service-recipes` dipende solo dal job di schema, non dalla disponibilità di Zenodo.

Questo separa la disponibilità dell'applicazione dalla disponibilità del provider esterno. Se il catalogo non è ancora importato o il provider è offline, Recipes resta avviabile; le suggestions riflettono il catalogo effettivamente disponibile.
