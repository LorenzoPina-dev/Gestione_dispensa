# Operazioni

## Avvio locale

```bash
docker compose up --build -d --wait
```

Ingresso: `https://<LAN_HOST>:8443/`. Compose avvia NGINX, web, gateway, servizi, dipendenze e job di inizializzazione secondo healthcheck e dipendenze. Il provider OIDC è Keycloak. Le porte interne non devono essere chiamate dal browser.

Per stato e configurazione:

```bash
docker compose ps
docker compose config --quiet
npm run compose:verify
```

## Migrazioni e bootstrap

Database iniziali e ruoli sono preparati da `infrastructure/postgres/init` e `postgres-app-role-init`. Le migration di ogni bounded context sono in `services/<service>/migrations`; Food Semantics e Recipes usano container one-shot dedicati nel compose. Bootstrap ontologia e import catalogo ricette sono ulteriori processi one-shot. Non c'è un container centrale `db-migrate`.

## Health e diagnostica

I servizi HTTP forniscono `/health/live` e `/health/ready`. Verificare il log del servizio proprietario per errori di dipendenza o migrazione:

```bash
docker compose logs --tail=200 gateway service-catalog service-food-semantics service-recipes
```

Per le code/eventi controllare Redis e i relay/consumer del dominio; gli eventi persistono prima nell'outbox PostgreSQL. Per la ricerca OFF, controllare in ordine `service-catalog`, `off-lookup`, `search-indexer`, OpenSearch e MongoDB. Per OCR controllare `service-ocr`, `worker-ocr`, Redis, MinIO e provider configurato.

## Osservabilità

OpenTelemetry Collector riceve telemetria; Tempo conserva trace, Alloy raccoglie log container verso Loki, Prometheus raccoglie metriche ed exporter/cAdvisor. Grafana presenta le sorgenti configurate. Vedi [NETWORK.md](NETWORK.md) per segmentazione e [DIAGRAMS.md](DIAGRAMS.md#osservabilità) per il flusso.
