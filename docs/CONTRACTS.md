# Contract Governance

Questa è la policy normativa che impedisce che implementazioni diverse introducano contratti incompatibili.

## 1. Gerarchia delle specifiche

In caso di ambiguità:

1. DATA.md definisce ownership e persistenza.
2. API.md definisce semantica HTTP, request/response ed errori.
3. openapi.yaml è la rappresentazione machine-readable del contratto HTTP.
4. EVENTS.md definisce envelope e payload asincroni.
5. SERVICES.md definisce owner, porte e DB.
6. FLOWS.md descrive la sequenza tra contratti.

Il codice non può introdurre un comportamento non documentato come comportamento implicito.

## 2. Service contract package

Ogni servizio deve contenere:

```
services/<service>/
  src/
    domain/
    application/
    infrastructure/
    http/
      routes/
      schemas/
    events/
  migrations/
  contract/
    openapi.yaml
    events/
  Dockerfile
  package.json
```

Il contratto locale può essere un sottoinsieme del contratto Gateway e dei contratti interni, ma non può contraddirli.

## 3. Versioning

HTTP pubblico:
- URL versionato solo quando serve un breaking change;
- additive change: nuovo campo opzionale;
- breaking request: nuova versione;
- breaking response: nuova versione;
- enum: aggiungere un valore è breaking per client strict, quindi va trattato come change di contratto.

Eventi:
- schemaVersion obbligatorio;
- breaking change => nuova versione;
- producer deve mantenere compatibilità per il periodo definito;
- consumer deve ignorare campi opzionali sconosciuti ma rifiutare schema invalidi.

## 4. Validation

La validazione avviene a tre livelli:

1. Gateway: sintassi, auth context, size/rate limit.
2. Service: schema + authorization + invarianti di dominio.
3. Database: CHECK, UNIQUE, NOT NULL e vincoli locali.

La validazione del Gateway non sostituisce quella del service owner.

## 5. Authorization

Ogni request autenticata contiene subject/userId, familyId, roles, requestId e correlationId.

Il Gateway costruisce il contesto; il service owner decide se l'operazione è autorizzata.

Non è consentito fidarsi di familyId proveniente dal body se non coincide con il contesto autorizzato.

## 6. Mutation protocol

Ogni mutation deve definire:
- input schema;
- output schema;
- status code;
- error codes;
- idempotency policy;
- concurrency policy;
- evento prodotto, se presente;
- owner DB;
- side effects;
- audit requirements.

Una mutation multi-service non esegue SQL remoto. Usa API/eventi/saga.

## 7. Idempotency protocol

Per POST/PATCH/PUT/DELETE mutanti si usa X-Idempotency-Key.

La chiave è associata a actor + family + request hash.

Stessa chiave + stesso request hash:
- restituisce la risposta originaria.

Stessa chiave + hash diverso:
- 409 IDEMPOTENCY_KEY_REUSED.

Retry dopo timeout:
- non crea una seconda mutation.

## 8. Optimistic concurrency

Le entity mutabili usano:

```
ETag: "version-7"
If-Match: "version-7"
```

Se la versione DB è diversa:
- HTTP 412;
- PRECONDITION_FAILED;
- nessuna mutation parziale.

## 9. No implicit fields

Request body con additionalProperties=false nel contratto pubblico, salvo payload esplicitamente estensibili.

Response:
- non aggiungere campi che cambiano la semantica;
- i client devono ignorare campi opzionali aggiunti in modo compatibile.

## 10. Error contract

Formato unico:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {"field":"quantity","reason":"must_be_positive"}
    ],
    "requestId":"uuid"
  }
}
```

Codici applicativi devono essere stabili e documentati.

## 11. Data contract

Un service può emettere solo dati di cui è owner o projection esplicitamente marcate.

Esempio:
- Catalog risolve barcode -> productId canonical.
- Inventory decide se quel productId è nella dispensa.
- Shelf-Life produce una prediction.
- Inventory decide se applicarla alla pantry state.
- OFF Lookup fornisce dati OpenFoodFacts.
- Catalog decide quali dati diventano canonical product data.

## 12. Contract testing obbligatorio

CI deve eseguire:
- validazione sintattica OpenAPI;
- endpoint schema tests;
- request validation tests;
- response validation tests;
- error contract tests;
- HTTP consumer/provider contract tests;
- event envelope tests;
- event payload compatibility tests;
- migration tests su DB dedicato;
- test di isolamento DB.

Un servizio non è pronto se il codice funziona ma il contratto non è verificabile automaticamente.

## 13. Database contract tests

Ogni servizio deve verificare che:
- la propria connection string punta al DB corretto;
- migration crea solo tabelle del proprio DB;
- account DB non può accedere agli altri DB;
- nessuna FK punta fuori DB;
- nessuna query cross-service è presente;
- outbox è nella stessa transazione della mutation;
- retry della stessa idempotency key non duplica dati.

## 14. Contract-to-code traceability

Ogni endpoint deve avere:

```
documented route
 -> OpenAPI operationId
 -> request schema
 -> handler
 -> application command/query
 -> owner repository
 -> DB migration
 -> tests
```

Ogni evento deve avere:

```
eventType/schemaVersion
 -> producer
 -> payload schema
 -> outbox writer
 -> consumer(s)
 -> consumer tests
```

## 15. Definition of Done

Una feature è implementata solo quando:
- il service owner è identificato;
- il DB owner e le migration esistono;
- request/response sono documentati;
- errori sono documentati;
- endpoint OpenAPI è presente;
- auth/tenant rules sono definite;
- idempotency/concurrency sono definite;
- eventi sono definiti se necessari;
- test unit/integration/contract esistono;
- non esistono accessi cross-DB;
- failure e retry sono definiti;
- osservabilità e audit sono definiti.

**Non è accettabile implementare prima e decidere il contratto dopo.**
