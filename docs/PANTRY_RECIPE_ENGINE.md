# Pantry-to-Recipe Engine

## Stato implementazione — 2026-10-08

### COMPLETATO

- [x] Separazione delle responsabilità: Inventory mantiene stock/quantità/scadenze; Catalog mantiene identità e fatti del prodotto; Recipes calcola matching, copertura e sicurezza.
- [x] Modello `product_food_semantics` nel database Catalog con materializzazione atomica, versione delle regole e backfill one-shot.
- [x] Derivatore deterministico `food-semantics.ts` a partire dal dato OFF già curato nel Catalog.
- [x] Normalizzazione di accenti, maiuscole, separatori e prefissi lingua dei tag OFF.
- [x] Alias multilingua per gli ingredienti principali italiano/inglese e varianti singolare/plurale.
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
- [x] Matching Recipes basato su nome + identità canonica + termini semantici + tassonomia, invece del solo nome commerciale.
- [x] Nuovo modello semantico per `recipe_catalog.recipe_ingredients` e `recipes_domain.recipe_ingredients`.
- [x] Canonicalizzazione degli ingredienti delle ricette con quantità normalizzate, dimensione fisica, unità base, confidenza e stato di preparazione.
- [x] `Weight` del dataset mantenuto come peso compositivo della ricetta e separato dalle quantità di dispensa: non viene trattato come grammi.
- [x] Quantity engine con massa, volume e conteggio; conversioni soltanto entro la stessa dimensione.
- [x] Conversione confezione -> contenuto solo quando la quantità della confezione è nota esplicitamente.
- [x] Gestione di frazioni comuni, decimali con virgola e unità da cucina comuni.
- [x] Stati di copertura distinti: `COMPLETE`, `PARTIAL`, `MISSING`, `PRESENCE_ONLY`, `INCOMPATIBLE`.
- [x] Aggregazione di più righe della stessa identità culinaria prima dello scoring.
- [x] Score ponderato secondo `STAPLE=0.1`, `SECONDARY=0.5`, `CORE=1.0`.
- [x] Soglie di readiness: `>=0.80 READY`, `0.50-0.79 MINIMAL_SHOPPING`, `<0.50 DISCARD`.
- [x] Conteggio separato dei CORE mancanti per il ranking.
- [x] Sostituzioni funzionali curate con fattore 0.8: lo stock esatto viene utilizzato prima, il sostituto copre solo l'eventuale residuo.
- [x] Confidenza semantica persistita sugli ingredienti di ricetta; un canonical match debole non viene considerato identità certa.
- [x] Ranking secondario per numero di CORE mancanti e tempo di preparazione.
- [x] Profilo alimentare personale in Identity con allergeni, restrizioni dietetiche e policy sulle tracce, versionato con ETag.
- [x] Filtro di sicurezza Recipes: allergene noto -> `BLOCK`; traccia -> `WARN` o `BLOCK` secondo policy; restrizione dietetica incompatibile -> `BLOCK`.
- [x] Stato `UNKNOWN_COMPOSITION` quando la composizione non è sufficientemente normalizzata: nessuna falsa garanzia di sicurezza.
- [x] Gateway già compatibile con il nuovo endpoint Identity tramite la rotta generalizzata `/api/v1/identity`.
- [x] Test deterministici aggiunti per quantity engine, copertura ponderata, conversione confezioni, unità incompatibili, allergeni, tracce, profili vegetariano/pescetariano e normalizzazione del profilo.
- [x] Correzione del parser delle istruzioni: le sezioni `HowToSection` vengono espanse nei relativi `itemListElement`, evitando output come `Boiling / Browning / Mixing` quando sono solo titoli di sezione.
- [x] Correzione della regressione TSX di `Ricette.tsx`.

### IN IMPLEMENTAZIONE / MANCANTE

- [ ] Parsing robusto di `ingredients_text` quando `ingredients_tags` è assente, inclusi quantità integrate nel testo e più lingue.
- [ ] Modello per prodotti composti (es. pesto, sughi, piatti pronti) con `food_components[]`, percentuali, ruoli e confidenza.
- [ ] Mapping recipe ingredient -> canonical ingredient con gerarchie alimentari, sinonimi, iperonimi/iponimi e categorie funzionali.
- [ ] Densità e conversioni massa<->volume solo quando esiste una regola/dato affidabile e versionato per quello specifico ingrediente.
- [ ] Modello di “quantità usabile”: packaging aperto, residui, porzioni, sfridi e prodotti non interamente disponibili.
- [ ] Sostituzioni semantiche/funzionali con fattore parziale `0.8 * peso originale`, motivazione e limiti.
- [ ] Profilo famigliare: combinazione sicura di più profili personali senza duplicare la fonte dati.
- [ ] Policy separate per allergie assolute, tracce e contaminazione incerta.
- [ ] Calcolo nutrizionale per porzione e ranking nutrizionale.
- [ ] RecipeMatch definitivo e stabile con matched products, quantità effettivamente utilizzabili, mancanti, sostituzioni, sicurezza e spiegazione dello score.
- [ ] Cache/materializzazione del profilo semantico nel Catalog con invalidazione quando cambia la proiezione OFF.
- [ ] Versionamento esplicito delle regole per riprodurre un risultato storico.
- [ ] Import del catalogo ricette spostato da startup di `service-recipes` a job/worker one-shot: il servizio applicativo non deve dipendere dalla disponibilità di Zenodo.
- [ ] Test matrix ampia con prodotti multilingua, quantità senza unità, confezioni, duplicati, dati OFF parziali, ingredienti composti e collisioni semantiche.
- [ ] Validazione/build completa in ambiente Docker. In questa sessione il repository non era clonabile dal runtime per un errore DNS verso GitHub, quindi i test aggiunti non sono stati dichiarati come eseguiti.
- [ ] Fallback controllati quando mancano dati: nessuna invenzione di ingredienti, ma stato `UNKNOWN`/`AMBIGUOUS` dove necessario.
- [ ] Promuovere UNKNOWN_COMPOSITION a policy configurabile fail-closed per profili con allergie assolute.

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
