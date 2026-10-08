# Pantry-to-Recipe Engine

## Stato implementazione — 2026-10-08

### COMPLETATO
- [x] Separazione delle responsabilità: Inventory mantiene stock/quantità/scadenze; Catalog mantiene identità del prodotto; Recipes calcola il matching.
- [x] Nuovo modello `product_food_semantics` nel database Catalog per materializzare in seguito il profilo semantico.
- [x] Derivatore deterministico `food-semantics.ts` a partire dal dato OFF già curato nel Catalog.
- [x] Normalizzazione di accenti, maiuscole, separatori e prefissi lingua dei tag OFF.
- [x] Alias multilingua per gli ingredienti principali (italiano/inglese e varianti singolare/plurale).
- [x] Mappatura iniziale taxonomy/tag -> ingrediente canonico.
- [x] Conservazione distinta di `ingredientTerms`, `taxonomyTags`, `allergenTags`, `traceTags` e `labelTags`.
- [x] Prima classificazione culinaria `STAPLE`, `SECONDARY`, `CORE`.
- [x] Normalizzazione delle quantità di confezione in base comuni `g`, `ml`, `piece`.
- [x] Confidenza separata per semantica e quantità.
- [x] Esposizione del profilo semantico nel batch Catalog usato da Recipes.
- [x] Matching Recipes basato su nome + identità canonica + termini semantici + tassonomia, invece del solo nome commerciale.
- [x] Correzione del parser delle istruzioni: le sezioni `HowToSection` ora vengono espanse nei relativi `itemListElement`, evitando output come `Boiling / Browning / Mixing` quando sono solo titoli di sezione.
- [x] Correzione della regressione TSX di `Ricette.tsx`.

### IN IMPLEMENTAZIONE
- [ ] Parsing robusto di `ingredients_text` quando `ingredients_tags` è assente.
- [ ] Canonicalizzazione di prodotti composti (es. pesto, sughi, piatti pronti) in più ingredienti con ruoli.
- [ ] Mapping recipe ingredient -> canonical ingredient con sinonimi, iperonimi/iponimi e sostituzioni.
- [ ] Motore quantità: conversione peso/volume/pezzi, densità quando disponibile, confezioni multiple e quantità minima necessaria.
- [ ] Copertura ponderata `STAPLE/SECONDARY/CORE` come score principale.
- [ ] Score parziale per sostituzioni e registro della motivazione.
- [ ] Filtri allergeni assoluti con gestione di `allergens_tags` e `traces_tags`.
- [ ] Profilo dieta utente (`vegan`, `vegetarian`, `gluten-free`, ecc.) applicato prima del ranking.
- [ ] Profilo personale/famigliare per allergie e preferenze, senza duplicare dati nel Catalog.
- [ ] Calcolo nutrizionale per porzione e ranking nutrizionale.
- [ ] API stabile di `RecipeMatch` con matched products, quantità utilizzata, mancanti, sostituzioni e safety warnings.
- [ ] Test matrix multilingua/unità/quantità/allergeni e casi con dati OFF incompleti.
- [ ] Materializzazione/cache del profilo semantico nel Catalog con invalidazione quando cambia la proiezione OFF.
- [ ] Versionamento delle regole di normalizzazione per poter riprodurre un vecchio risultato.
- [ ] Fallback controllati quando mancano dati: nessuna invenzione di ingredienti, ma stato `UNKNOWN`/`AMBIGUOUS` dove necessario.

## Decisioni architetturali
1. Un prodotto commerciale non viene considerato direttamente un ingrediente solo perché il nome contiene una parola simile.
2. L'identità culinaria è una proiezione derivata dal Catalog/OFF e ha sempre una confidenza.
3. `Inventory` non conosce sinonimi, allergeni o tassonomie.
4. `Recipes` non dipende dal dump MongoDB OFF: riceve dal Catalog una rappresentazione canonica stabile.
5. Un dato assente non viene trasformato in un fatto: viene mantenuta l'incertezza.
6. Gli allergeni sono un filtro di sicurezza, non un semplice fattore di ranking.
7. Le conversioni di quantità sono separate dal matching semantico: 'che ingrediente è?' e 'quanto ne ho?' sono problemi diversi.

## Prossimo incremento
Il prossimo blocco deve introdurre il quantity engine e il recipe ingredient model. È il passaggio necessario per distinguere correttamente, ad esempio, 2 x 180 g pomodori da 1 x 180 g, e per evitare che la semplice presenza di un prodotto generi una copertura 100% quando la quantità disponibile non basta.
