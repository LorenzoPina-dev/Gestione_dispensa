# Gestione Dispensa

Gestione Dispensa è una piattaforma web per la gestione domestica di dispensa, spesa, ricette e dati nutrizionali. Il backend è composto da servizi per dominio; la SPA esistente comunica con le API attraverso il Gateway.

## Architettura runtime

- Ingresso HTTPS: NGINX `:8443`; il browser non accede alle porte interne.
- API Gateway: `:3300`, raggiunto da NGINX su `/api`.
- Keycloak fornisce autenticazione OIDC.
- PostgreSQL ospita database logici separati per ogni dominio e per Keycloak.
- Redis gestisce code job e Redis Streams per eventi.
- MongoDB conserva il catalogo/cache Open Food Facts; OpenSearch ne indicizza la ricerca.
- MinIO fornisce storage oggetti per i flussi configurati, come ricevute OCR.
- Food Semantics usa ontologia alimentare e LibreTranslate per risoluzione e label multilingua.
- Prometheus, Grafana, Loki, Tempo, Alloy, OTel Collector e cAdvisor forniscono osservabilità.

Il Compose attuale non include Kafka. La topologia effettiva, inclusi i worker e i job one-shot, è documentata in [docs/SERVICES.md](docs/SERVICES.md).

## Sviluppo

I servizi sono buildabili separatamente. Per esempio:

```bash
docker compose build service-inventory
docker compose up -d service-inventory
```

Ingresso: `https://<LAN_HOST>:8443/`. Per avvio, healthcheck e diagnosi vedere [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Documentazione canonica

- [Indice e mappa repository](docs/README.md)
- [Architettura](docs/ARCHITECTURE.md)
- [Diagrammi architettura, database e flussi](docs/DIAGRAMS.md)
- [Servizi e processi Compose](docs/SERVICES.md)
- [Database e storage](docs/DATA.md)
- [Flussi applicativi](docs/FLOWS.md)
- [API](docs/API.md) e [contratto OpenAPI](docs/openapi.yaml)
- [Eventi asincroni](docs/EVENTS.md)
- [Sicurezza](docs/SECURITY.md) e [reti](docs/NETWORK.md)
- [Operazioni](docs/OPERATIONS.md) e [test](docs/TESTING.md)
