# Gestione_dispensa

Un gestionale intelligente per tracciare il cibo in dispensa e aiutare a fare la spesa in modo più intelligente.

## Stato del progetto

La documentazione costituisce il pacchetto di handoff per il team di sviluppo. L'implementazione ha
completato la fondazione tecnica, i contratti, la configurazione, l'osservabilità, il migration
runner e i confini identity/authorization. Lo stato puntuale è in [docs/IMPLEMENTATION-STATUS.md](docs/IMPLEMENTATION-STATUS.md).

## Documentazione

- [Blueprint tecnico](docs/BLUEPRINT.md)
- [Requisiti di prodotto e sistema](docs/REQUIREMENTS.md)
- [Product brief e metriche di successo](docs/PRODUCT-BRIEF.md)
- [Glossario di dominio](docs/DOMAIN-GLOSSARY.md)
- [Decisioni e assunzioni](docs/DECISIONS-AND-ASSUMPTIONS.md)
- [User journeys e requisiti di esperienza](docs/USER-JOURNEYS-AND-UX.md)
- [Specifiche tecniche dei componenti](docs/COMPONENT-SPECIFICATIONS.md)
- [Contratti API ed eventi](docs/CONTRACTS.md)
- [OpenAPI versionata](docs/openapi.yaml)
- [Catalogo completo degli endpoint](docs/API-ENDPOINT-CATALOG.md)
- [JSON Schema eventi e job](docs/EVENT-SCHEMAS.md)
- [ERD e ownership dati](docs/DATA-MODEL-ERD.md)
- [Matrice di autorizzazione](docs/AUTHORIZATION-MATRIX.md)
- [Configuration contract](docs/CONFIGURATION-CONTRACT.md)
- [Retention e ciclo di vita dati](docs/RETENTION-AND-DATA-LIFECYCLE.md)
- [SLO, SLI ed error budget](docs/SLO-ERROR-BUDGET.md)
- [Runbook operativi](docs/RUNBOOKS.md)
- [Deployment contract](docs/DEPLOYMENT-CONTRACT.md)
- [Policy migrazioni e seed](docs/MIGRATION-AND-SEED-POLICY.md)
- [Quality gate documentale](docs/DOCUMENTATION-QUALITY-GATE.md)
- [UI screen specifications](docs/UI-SCREEN-SPECIFICATIONS.md)
- [Provider matrix](docs/PROVIDER-MATRIX.md)
- [Test strategy](docs/TEST-STRATEGY.md)
- [Architettura dati e strategia database](docs/DATABASE-ARCHITECTURE.md)
- [Profili famigliari e inviti QR](docs/FAMILY-PROFILES-AND-QR-INVITES.md)
- [Flussi dati, UI e contratti operativi](docs/DATA-FLOWS-UI-CONTRACTS.md)
- [Privacy, profilazione e analytics](docs/PRIVACY-PROFILING-AND-ANALYTICS.md)
- [Engineering handoff e prossimi passi](docs/ENGINEERING-HANDOFF-AND-NEXT-STEPS.md)
- [Gap analysis e rischi residui](docs/GAP-ANALYSIS.md)
- [Readiness audit: cosa manca](docs/READINESS-AUDIT.md)
- [Implementation status: stato corrente](docs/IMPLEMENTATION-STATUS.md)
- [Threat model e security architecture](docs/THREAT-MODEL.md)
- [Matrice di tracciabilità](docs/TRACEABILITY.md)
- [ADR-0001: architettura a servizi e deployment progressivo](docs/ADR-0001-deployment-architecture.md)
- [ADR-0002: piattaforma unificata di osservabilità](docs/ADR-0002-observability-stack.md)
- [ADR-0003: strategia database polyglot controllata](docs/ADR-0003-database-strategy.md)
- [ADR-0004: local-first e family-first release](docs/ADR-0004-local-first-family-release.md)
- [Operazioni, resilienza e osservabilità](docs/OPERATIONS-AND-RESILIENCE.md)

## Direzione tecnica

- Next.js + React + TypeScript per la web app e la PWA;
- NestJS per API REST versionate e worker applicativi;
- PostgreSQL come database principale;
- Redis + BullMQ per cache e job asincroni;
- storage S3-compatible per immagini e allegati;
- OIDC/OAuth2 per autenticazione, RBAC/ABAC per autorizzazione;
- OpenTelemetry Collector, Prometheus, Grafana, Alertmanager, Loki e Tempo per monitoring, alerting, log e tracing end-to-end;
- servizi modulari indipendenti, eseguibili con Docker Compose e separabili in deploy distinti;
- k3s/Kubernetes come percorso di crescita, introdotto quando scaling e operatività ne giustificano il costo.
- primo rilascio `family-local` completamente locale via Docker Compose, con PostgreSQL, Redis, MinIO, Keycloak, Grafana, Prometheus, Alertmanager, Loki, Tempo e OpenTelemetry.

## Stato dell'implementazione

- Fondazione API disponibile in `apps/api` con `/health/live`, `/health/ready` e `/api/v1/meta`;
- profilo Compose iniziale disponibile con API, PostgreSQL e Redis;
- policy Compose iniziale disponibile con health check, rete dedicata, graceful shutdown e limiti di risorse;
- migration foundation PostgreSQL disponibile in `infra/postgres/init`;
- le funzionalità di famiglia, QR, catalogo, inventario, shopping e osservabilità completa restano i prossimi incrementi;
- avvio locale: `npm.cmd install`, `npm.cmd run build`, `npm.cmd start` oppure `docker compose --profile family-local up --build`.

## Struttura della repository

La repository è organizzata come monorepo npm. La mappa completa di ownership e dei deployable è
in [docs/REPOSITORY-STRUCTURE.md](docs/REPOSITORY-STRUCTURE.md). Le cartelle vuote rappresentano
confini architetturali pianificati e non implementazioni simulate.

La pipeline completa di implementazione e il protocollo per il lavoro parallelo degli agenti sono
in [docs/IMPLEMENTATION-PIPELINE.md](docs/IMPLEMENTATION-PIPELINE.md) e
[docs/AGENT-WORK-PACKAGES.md](docs/AGENT-WORK-PACKAGES.md).
