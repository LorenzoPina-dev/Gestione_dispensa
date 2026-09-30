# Security

## Identity
Keycloak/OIDC autentica gli utenti. Il Gateway propaga il contesto, ma ogni service autorizza le operazioni sul proprio dominio.

## Tenant isolation
Le risorse familiari sono autorizzate tramite subject/familyId verificati server-side. Un ID del client non è autorizzazione.

## Database isolation
Ogni service possiede credenziali dedicate per il proprio DB. Nessun servizio può interrogare il DB di un altro servizio.

## Inviti
I token sono temporanei, revocabili e consumabili. Risolvere un token non concede membership; l'accept autenticato crea la membership tramite Family.

## Privacy
Privacy coordina consenso, export ed erasure tramite API/eventi. Non accede direttamente ai database degli altri servizi. Ogni owner applica le proprie operazioni sui propri dati.

## Threat controls
- validazione input e schema;
- rate limiting sul Gateway;
- timeout/circuit breaker inter-service;
- secret management;
- audit degli eventi sensibili;
- redazione dei log;
- MinIO con accesso privato e policy least privilege.

## Data retention
I dati con retention specifica sono gestiti dal service owner. Le cancellazioni cross-service sono orchestrate tramite contratti, eventi e job; non tramite SQL cross-database.
