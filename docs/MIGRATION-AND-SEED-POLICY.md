# Policy migrazioni, seed e compatibilita dati

## 1. Ownership

Ogni schema ha un owner. Le migrazioni sono versionate, reviewate e applicate da un job dedicato, mai da ogni replica applicativa all'avvio.

## 2. Expand-contract

1. aggiungere colonne/tabelle nullable o compatibili;
2. deploy writer che supporta vecchio e nuovo schema;
3. backfill bounded, idempotente e osservabile;
4. deploy reader nuovo;
5. verificare conteggi, vincoli e latenza;
6. rendere obbligatorio il nuovo schema;
7. rimuovere il vecchio solo dopo finestra di compatibilita.

## 3. Dati iniziali

Seed solo sintetici e idempotenti:

- ruoli/permessi;
- categorie demo;
- locale/unita;
- prodotti fixture chiaramente marcati demo;
- recipe/offer fixture non presentate come reali.

Mai includere password, token, provider key, PII reale o foto personali.

## 4. Migrazioni ad alto rischio

Richiedono backup verificato, piano rollback/forward-fix, finestra operativa e test staging:

- cambio tipo quantita/unita;
- split family/household;
- partizionamento;
- unique constraint su dati sporchi;
- cancellazione/anonimizzazione;
- modifica event payload;
- rotazione cifratura.

## 5. Verifiche post-migration

- schema version expected;
- foreign key/unique/index validi;
- conteggi per family e movimenti invariati;
- outbox/inbox non persi;
- query p95 baseline;
- health/readiness;
- projection lag;
- backup successivo e restore spot check.
