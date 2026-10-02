# Network

Browser-facing:
```
Browser --HTTPS:8443--> Nginx
Nginx / -> Web
Nginx /api -> Gateway:3300
Nginx /realms -> Keycloak
```

Microservizi e datastore sono su rete interna. Le loro porte non sono pubblicate sull'host salvo debug controllato.

Data plane:
```
service-inventory -> inventory_db
service-family -> family_db
service-shopping -> shopping_db
service-catalog -> catalog_db
... ogni servizio -> proprio DB
off-lookup -> off_lookup_db
```

Nessun servizio dispone di credenziali per i DB degli altri servizi.


## Network segmentation

The Compose topology uses four logical planes:

- edge: only Nginx and the Web container are browser-facing.
- backend: internal-only service-to-service network; Gateway and domain services use it.
- data/messaging: internal-only infrastructure networks for PostgreSQL, MongoDB, Redis, Kafka and telemetry.
- egress: explicit outbound network attached only to services that must call external providers. The current base assigns it to OFF Lookup because Open Food Facts is its provider boundary.

Application services do not publish host ports. External traffic enters through Nginx and is routed to the Gateway; provider access is explicit rather than inherited by every backend service.
