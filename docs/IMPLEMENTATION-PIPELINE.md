# Implementation pipeline

La pipeline di sviluppo segue il bounded context proprietario.

## Work package contract

Ogni modifica deve dichiarare:

- servizio owner;
- endpoint/eventi/job coinvolti;
- migration/schema coinvolti;
- authorization e tenant boundary;
- test unit/integration/contract;
- impatto UI;
- osservabilità;
- rollback o recovery strategy.

## Order

```text
contract
  ↓
domain/service
  ↓
persistence
  ↓
async/event path
  ↓
Gateway route / Composite View
  ↓
UI
  ↓
E2E + operational evidence
```

## Cross-service rule

Una feature distribuita non trasferisce codice di dominio tra repository di servizio. Si usano contratti HTTP/event/job e package tecnici condivisi.
