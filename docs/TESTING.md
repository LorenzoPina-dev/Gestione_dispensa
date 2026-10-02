# Testing Contract — Microservices v2

Questo documento è normativo insieme a `docs/API.md` e `docs/openapi.yaml`.

## Livelli

- `test:unit`: regole pure, parser, normalizzazione, mapping e dominio. Non usa PostgreSQL reale? No: non deve simulare il database per dimostrare che il repository funzioni; i test unitari del dominio possono usare piccoli test double solo ai confini esplicitamente iniettati.
- `test:http`: adapter HTTP reale del servizio. Per router/controller isolati sono ammessi test double solo ai confini di dependency injection; non si mockano persistenza, transazioni o regole di dominio per far passare il contratto.
- `test:migration`: esecuzione delle migrazioni reali contro PostgreSQL reale, con verifica dello schema prodotto e della riesecuzione.
- `test:integration`: processo reale del servizio + database reale + dipendenze interne reali. Nessun mock fra microservizi.
- `test:e2e`: stack applicativo reale attraversando Gateway e, quando previsto, nginx.

## Politica sui mock

Un mock/test double è ammesso esclusivamente quando serve a isolare il comportamento del componente sotto test da un confine realmente esterno o non deterministico.

Non sono ammessi mock per:

- PostgreSQL nelle prove di repository, transazioni, idempotenza, locking o migrazioni;
- un altro microservizio nelle prove di integrazione;
- Gateway, HTTP client interno o worker nelle prove che dichiarano di essere integration/e2e;
- dati che il servizio dovrebbe leggere realmente dal proprio database.

Per provider esterni come Keycloak Admin API o servizi Open Food Facts, un test unitario può sostituire il confine HTTP con un double deterministico. La prova di integrazione deve invece usare il provider reale o un'istanza locale equivalente, senza alterare il percorso applicativo.

## Regola di regressione

Ogni bug riprodotto durante il refactoring deve diventare un test prima della correzione. Il test deve descrivere il contratto corretto quando il bug è una violazione del contratto, oppure il comportamento storico quando serve a preservare una compatibilità intenzionale.

Un servizio non è considerato verificato perché passa TypeScript o un health check: deve superare i livelli applicabili fino agli endpoint e, quando esistono dipendenze interne, il flusso cross-service.

## Regola sulle dipendenze reali

I test che richiedono infrastruttura devono fallire esplicitamente se l'infrastruttura/configurazione necessaria non è disponibile. Non devono passare silenziosamente sostituendo la dipendenza con un mock.

## Copertura

La copertura deve misurare la logica realmente eseguita. Le soglie verranno aumentate progressivamente; non è accettabile aumentare la percentuale aggiungendo test che esercitano soltanto adapter banali mentre repository, transazioni e workflow restano non verificati.

## Ordine di verifica per ogni servizio

1. Unit e funzioni pure.
2. Repository e migrazione su database reale.
3. Flusso completo interno del servizio.
4. Endpoint HTTP reali.
5. Integrazione con servizi interni reali.
6. E2E attraverso Gateway/nginx quando il servizio è stabile.

Il passaggio al servizio successivo avviene dopo aver registrato i test rossi residui e separato chiaramente difetti di implementazione, difetti di schema e difetti di integrazione.
