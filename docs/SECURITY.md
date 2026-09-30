# Security model

## Identity e authorization

Keycloak/OIDC autentica l'utente. Il Gateway costruisce il contesto della richiesta, ma ogni service verifica l'autorizzazione necessaria al proprio dominio.

Per le risorse familiari, `familyId` e subject devono essere derivati/verificati server-side. Un ID fornito dal client non costituisce autorizzazione.

## Database isolation

Ogni service riceve solo le credenziali del proprio DB:

```
service-inventory -> inventory_db
service-family    -> family_db
service-shopping  -> shopping_db
```

Nessun secret DB viene condiviso tra servizi.

## Invite security

Gli inviti famiglia usano token temporanei, revocabili/consumabili. La risoluzione del token non concede membership. La membership nasce solo durante una operazione accept autenticata e autorizzata.

## Data minimization

I servizi conservano solo i dati necessari al proprio bounded context. Export/erasure sono coordinati tramite Privacy e contratti/eventi, non tramite accesso diretto ai database.

## Secrets e logging

OIDC secret, password, token e credenziali DB non devono apparire nei log. Request/correlation/trace ID possono essere propagati.

## Object storage

Gli oggetti privati in MinIO sono accessibili tramite policy/URL temporanei coerenti con il service owner; non si usano URL pubblici permanenti per dati privati.
