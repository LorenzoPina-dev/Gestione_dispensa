# Reti

## Percorso pubblico

```text
Browser --HTTPS:8443--> NGINX
NGINX /             --> web
NGINX /api           --> Gateway:3300
NGINX /realms        --> Keycloak
```

Questi sono gli ingressi pubblicati. I servizi, gli worker e i datastore comunicano attraverso le reti Docker interne.

## Reti Compose

- `edge`: NGINX e web.
- `backend`: Gateway, servizi HTTP e dipendenze necessarie alle chiamate interne.
- `data`: database, code, relay e componenti osservabilità che leggono/scrivono dati.
- `egress`: processi che interrogano provider esterni, come Food Semantics/bootstrap, OFF lookup e import ricette.

I dettagli effettivi dei collegamenti sono definiti in `docker-compose.yml`. Non tutti i container appartengono a tutte le reti.

## Piano dati

PostgreSQL contiene database logici separati per servizio. Redis trasporta stream e code; MongoDB/OpenSearch supportano il catalogo OFF; MinIO contiene oggetti binari configurati. Vedere [DATA.md](DATA.md) e il [diagramma di architettura](DIAGRAMS.md#architettura-di-runtime).
