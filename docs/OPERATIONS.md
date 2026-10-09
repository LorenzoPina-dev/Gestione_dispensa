# Operazioni

## Avvio
```bash
docker compose up --build -d
```
Ingresso: `https://<LAN_HOST>:8443/`.

Compose prepara certificato locale, PostgreSQL/Redis, Keycloak, migration e servizi secondo healthcheck. `db-migrate` applica le migration.

## Health
Ogni servizio HTTP espone `/health/live`, `/health/ready` e, quando abilitato, `/metrics`.

## Observability
```text
services → logs/metrics/traces → Alloy/OTel → Loki/Prometheus/Tempo → Grafana
```
`requestId` e `traceId` seguono Nginx → Gateway → servizi → dipendenze.

## Diagnosi
1. `docker compose ps`
2. controllare `/health/ready`;
3. cercare `requestId`;
4. trovare il primo servizio in errore;
5. controllare dipendenze;
6. per DB verificare migration, connessione e SQLSTATE;
7. per job verificare PostgreSQL, Redis e worker;
8. per errori browser controllare Nginx poi Gateway.

## Quality gate
```bash
npm run validate:structure
npm run typecheck
npm run build
npm test
```

Non eseguire migration nei container applicativi; non esporre porte interne; MongoDB non è source of truth della dispensa; Redis non è storage durevole dei job.
