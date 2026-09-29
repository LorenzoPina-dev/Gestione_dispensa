# Configuration contract

La configurazione è per-processo e tipizzata. I servizi ricevono solo le variabili necessarie al proprio boundary.

## Core variables

```text
PORT
DATABASE_URL
REDIS_URL
OIDC_ISSUER
OIDC_AUDIENCE
OIDC_DISCOVERY_URL
OIDC_JWKS_URL
```

## Service URLs

I riferimenti interni usano DNS Docker/cluster, ad esempio:

```text
http://service-inventory:3312/api/v1
http://service-shelf-life:3404/api/v1
http://service-ocr:3405/api/v1
```

Il browser non riceve questi URL.

## Secret policy

Secret e credential non sono committati. Il processo valida la configurazione prima di aprire listener o consumare queue.
