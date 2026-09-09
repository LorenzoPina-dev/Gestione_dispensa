# Configuration contract

## 1. Regole

- configurazione validata prima di avviare il servizio;
- secret e riferimenti secret non vengono committati;
- ogni variabile ha tipo, default, profilo, owner e rischio;
- cambi runtime sono auditati e versionati;
- default sicuri: feature opzionali disattive, TLS obbligatorio in ambienti non local, fail closed su autorizzazione;
- config non contiene dati di dominio;
- nessun servizio legge direttamente un file di configurazione di un altro servizio.

## 2. Profili

| Profilo | Scopo | Capability opzionali | Persistenza |
|---|---|---|---|
| `local` | sviluppo individuale | mock provider | volumi locali, dati sintetici |
| `family-local` | primo rilascio famigliare completo | OCR/AI/offers disattivi di default | PostgreSQL, Redis, MinIO, Keycloak e observability locali |
| `home-small` | vecchio PC | OCR/offers/Tempo opzionali | backup esterno richiesto |
| `home-plus` | troubleshooting completo | observability estesa | retention aumentata |
| `test` | CI/integration | provider sandbox | dati effimeri |
| `staging` | pre-produzione | provider sandbox | simile production |
| `production` | utenti reali | policy approvate | storage/backup ridondati |

## 3. Variabili comuni

| Variabile | Tipo | Secret | Default | Profilo | Validazione |
|---|---|---:|---|---|---|
| `APP_ENV` | enum | no | `local` | tutti | enum profili |
| `APP_VERSION` | string | no | required CI | tutti | semver/build |
| `PUBLIC_BASE_URL` | URL | no | required | tutti | HTTPS non-local |
| `API_BASE_URL` | URL | no | required | web/API | allowlist |
| `LOG_LEVEL` | enum | no | `info` | tutti | debug solo local |
| `TIMEZONE_DEFAULT` | IANA TZ | no | `UTC` | tutti | tz database |
| `LOCALE_DEFAULT` | locale | no | `it-IT` | tutti | supported locale |
| `FEATURE_PROFILE_VERSION` | string | no | required | tutti | config schema |

## 4. Identity e sicurezza

| Variabile | Tipo | Secret | Default | Note |
|---|---|---:|---|---|
| `OIDC_ISSUER_URL` | URL | no | required | issuer allowlist |
| `OIDC_CLIENT_ID` | string | no | required | per ambiente |
| `OIDC_CLIENT_SECRET_REF` | secret ref | riferimento | required | mai raw in env commit |
| `OIDC_AUDIENCE` | string | no | required | token validation |
| `SESSION_SECRET_REF` | secret ref | riferimento | required | rotation support |
| `COOKIE_SECURE` | boolean | no | true non-local | fail closed |
| `CORS_ALLOWED_ORIGINS` | list URL | no | empty | no wildcard prod |
| `RATE_LIMIT_INVITE_PER_MINUTE` | integer | no | 10 | per IP/principal |
| `QR_INVITE_MAX_TTL_SECONDS` | integer | no | 600 | 60..86400 |
| `QR_FALLBACK_MAX_ATTEMPTS` | integer | no | 5 | per token/IP window |

## 5. Database e messaging

| Variabile | Tipo | Secret | Default | Note |
|---|---|---:|---|---|
| `DATABASE_URL_REF` | secret ref | riferimento | required | TLS production |
| `DATABASE_POOL_MAX` | integer | no | profile-specific | budget globale |
| `DATABASE_STATEMENT_TIMEOUT_MS` | integer | no | 5000 | route override controllato |
| `DATABASE_MIGRATION_MODE` | enum | no | `external` | mai migration concorrenti |
| `REDIS_URL_REF` | secret ref | riferimento | required | TLS production |
| `REDIS_AOF_ENABLED` | boolean | no | true | non autorevole |
| `QUEUE_PREFIX` | string | no | environment | collision avoidance |
| `QUEUE_DEFAULT_MAX_ATTEMPTS` | integer | no | 5 | override per job |
| `QUEUE_BACKOFF_POLICY` | enum | no | `exponential-jitter` | bounded |
| `OUTBOX_PUBLISH_BATCH_SIZE` | integer | no | 100 | bounded |

## 6. Storage e provider

| Variabile | Tipo | Secret | Default | Note |
|---|---|---:|---|---|
| `OBJECT_STORAGE_ENDPOINT` | URL | no | profile-specific | S3-compatible |
| `OBJECT_STORAGE_BUCKET_REF` | reference | no | required | bucket per ambiente |
| `OBJECT_STORAGE_CREDENTIAL_REF` | secret ref | riferimento | required | least privilege |
| `MEDIA_MAX_BYTES` | integer | no | 10485760 | quota |
| `MEDIA_ALLOWED_MIME` | list | no | jpeg/png/pdf | magic bytes validate |
| `OCR_PROVIDER` | enum | no | `disabled` | adapter allowlist |
| `OCR_API_KEY_REF` | secret ref | riferimento | optional | provider DPA |
| `AI_PROVIDER` | enum | no | `disabled` | opt-in/policy |
| `AI_BUDGET_DAILY_MINOR` | integer | no | 0 local | cost guard |
| `RETAILER_SOURCE_IDS` | list | no | empty | licensed sources only |

## 7. Observability

| Variabile | Tipo | Secret | Default |
|---|---|---:|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL | no | profile-specific |
| `OTEL_SERVICE_NAME` | string | no | required |
| `OTEL_TRACES_SAMPLER` | enum | no | `parentbased_traceidratio` |
| `OTEL_TRACES_SAMPLER_ARG` | decimal | no | `0.1` prod |
| `PROMETHEUS_RETENTION` | duration | no | `14d home` |
| `LOKI_ENABLED` | boolean | no | false home-small |
| `TEMPO_ENABLED` | boolean | no | false home-small |
| `LOG_REDACTION_MODE` | enum | no | `strict` |
| `ALERTMANAGER_URL` | URL | no | required non-local |

## 8. Resource budgets

| Profilo | API RAM | Core worker RAM | DB RAM | Observability RAM target |
|---|---:|---:|---:|---:|
| family-local | 256-512 MB | 128-256 MB | dimensionare da host | <= 1 GB con Loki/Tempo ridotti |
| home-small | 256-512 MB | 128-256 MB | dimensionare da host | <= 512 MB |
| home-plus | 512 MB | 256 MB | dimensionare da host | <= 1 GB |
| production | benchmark | benchmark | managed/limit | capacity plan |

I valori sono starting budgets, non garanzie. OOM, queue lag e p95 devono guidare il tuning.

## 9. Lifecycle

1. schema validation;
2. load non-secret config;
3. resolve secret references;
4. validate connectivity only for readiness, not startup indiscriminato;
5. emit sanitized config fingerprint;
6. expose config version in telemetry;
7. rotate secrets without logging values;
8. audit changes and rollback previous version.

## 10. Prohibited configuration

- wildcard CORS in production;
- plaintext secrets in repository, image, logs o dashboard;
- provider AI enabled senza budget/consenso/config DPA;
- QR TTL infinito o fallback senza rate limit;
- DB migration automatica concorrente in ogni replica;
- `LOG_LEVEL=debug` permanente in production;
- feature enterprise attiva senza tenant scope e audit;
- fail-open authorization.
