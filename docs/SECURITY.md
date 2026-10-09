# Sicurezza

## Authentication
Keycloak è l'Identity Provider OIDC. Gateway verifica issuer, audience e firma; i servizi verificano il contesto necessario al proprio dominio.

## Authorization
```text
JWT valido → principal → family membership → ruolo/resource → transaction
```
Conoscere un UUID non concede accesso alla risorsa.

## Tenant isolation
Ogni dato familiare ha `familyId`. Le query filtrano per tenant; RLS PostgreSQL può fornire una seconda barriera.

## Dati sensibili
Mai registrare token OIDC, password, cookie, bearer token, token QR, codici invito o immagini nei log.

## Inviti
Token opachi, monouso, con scadenza e non persistiti in chiaro. La scansione crea un tentativo temporaneo; solo accept crea membership.

## Upload / audit
Validare tipo e dimensione degli upload e associarli a owner/family. Le operazioni sensibili producono audit append-only senza segreti.

La sicurezza è applicata nel punto in cui vive la risorsa: Nginx/Gateway proteggono il perimetro, il servizio owner protegge il dato.
