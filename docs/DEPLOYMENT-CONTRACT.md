# Deployment contract e topologie

## 1. Componenti deployable

| Componente | Processo | Persistenza | Replica home | Replica production | Autoscaling |
|---|---|---|---:|---:|---|
| web | Next.js | none | 1 | 2+ | CPU/request |
| gateway | reverse proxy/API gateway | config | 1 | 2+ | CPU/request |
| api | REST/BFF | none | 1 | 2+ | CPU/latency |
| family/catalog/inventory/shopping | domain handlers | PostgreSQL | in api o 1 | separabile | request |
| worker-core | consumer | PostgreSQL/Redis | 1 | 2+ per queue | backlog |
| worker-integrations | OCR/offers/AI | job DB/S3 | off/1 | per capability | queue age |
| worker-notifications | delivery | job DB | off/1 | per provider | backlog |
| scheduler | cron/locks | PostgreSQL | 1 | 1 active + leader election | no |
| search-indexer | projection | search backend | off/1 | per backlog | lag |
| postgres | stateful DB | volume + backup | 1 | HA/managed | capacity plan |
| redis | queue/cache | AOF/volume | 1 | HA/managed | memory/lag |
| object storage | media | bucket | local/remote | replicated/managed | storage |
| observability | OTel/Prom/Grafana/etc | volumes | profile-based | replicated/managed | retention |

## 2. Compose profiles

- `core`: web, gateway, api, postgres, redis, worker-core;
- `recognition`: worker-integrations + object storage + provider adapter;
- `recipes`: recipe worker + nutrition source;
- `offers`: offers scheduler/worker + authorized adapters;
- `notifications`: notification worker;
- `search`: search-indexer + optional OpenSearch;
- `observability-small`: OTel, Prometheus, Grafana, Alertmanager;
- `observability-full`: aggiunge Loki e Tempo.
- `family-local`: profilo raccomandato per il primo rilascio; abilita `core`, `observability-full`, Keycloak, MinIO e scheduler/reconciliation.

Il profilo `family-local` e completamente locale e non richiede provider cloud per il core. Il profilo `core` deve funzionare senza gli altri profili; i profili opzionali non condividono secret non necessari.

## 3. Kubernetes mapping

- `Deployment`: web, gateway, api e worker stateless;
- `StatefulSet` o servizio gestito: PostgreSQL/Redis solo se non esterni;
- `CronJob`: scheduler tasks non continui;
- `HorizontalPodAutoscaler`: API e worker con metriche custom di backlog/latency;
- `PodDisruptionBudget`: api/core worker in multi-node;
- `NetworkPolicy`: deny-by-default e allowlist per service account;
- `Secret` via external secret manager;
- `ConfigMap`: configurazione non sensibile versionata;
- `PersistentVolumeClaim`: solo stato necessario, con snapshot policy;
- `Ingress/Gateway API`: TLS, routing e limits;
- `ServiceMonitor/PrometheusRule`: metriche e alert come codice.

## 4. Resource policy

Ogni workload dichiara requests/limits CPU e memoria, ephemeral storage, timeout e concurrency. `worker-core` ha quota riservata; OCR/AI/offers possono essere throttled o sospesi. OOMKill, restart e readiness failure generano alert.

## 5. Rollout

1. validare config e schema;
2. applicare migration expand;
3. deploy consumer backward-compatible;
4. deploy producer;
5. verificare health, SLO, queue e trace;
6. abilitare feature flag per percentuale/tenant;
7. eseguire backfill/reindex se previsto;
8. rimuovere vecchio schema solo dopo finestra compatibilita.

Rollback applicativo e rollback dati sono piani distinti. Non fare downgrade schema automatico senza procedura approvata.

## 6. Single-node limits

Su un singolo PC non esistono failover reali. Kubernetes/k3s puo riavviare container ma non protegge da perdita host/storage. Sono obbligatori backup esterno cifrato, restore drill e shutdown ordinato. Il profilo domestico deve privilegiare core e spegnere capability costose.

## 6.1 Family-local resource order

Ordine di priorita delle risorse sul vecchio PC:

1. PostgreSQL;
2. API/gateway/family/inventory/shopping;
3. worker-core;
4. Redis;
5. Keycloak;
6. Grafana/Prometheus/Alertmanager;
7. OTel/Loki/Tempo;
8. MinIO e capability opzionali.

Se memoria o disco scendono sotto soglia, vengono sospesi prima OCR/AI/offers, poi Loki/Tempo con retention ridotta. PostgreSQL, API, Redis, worker-core e audit non vengono autospegnati.

## 7. Production prerequisites

- almeno due nodi per HA applicativa;
- database/storage con replica e restore provato;
- registry immagini e artifact signing;
- secret manager;
- DNS/TLS/certificate lifecycle;
- monitoring/alerting indipendente;
- runbook e reperibilita;
- capacity/load test;
- network e tenant isolation verificati;
- budget per storage, provider e observability.
