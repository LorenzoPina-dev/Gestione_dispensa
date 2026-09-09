# ADR-0004: local-first e family-first release

- **Stato**: accettata
- **Data**: 2026-09-09
- **Decisione**: primo rilascio completamente locale via Docker Compose, orientato a famiglie, con core logic pronta allo scaling

## Contesto

Il primo ambiente sara un server locale/domestico. L'utente vuole eseguire database, Redis, Grafana, monitoring, autenticazione e servizi tramite container comunicanti su una rete Docker privata. Il primo rilascio deve essere famigliare, ma i confini della core logic devono rimanere compatibili con futura separazione in Kubernetes e con un eventuale modello retailer.

## Decisione

Il profilo principale del primo rilascio e `family-local` e include localmente:

- web/PWA;
- gateway;
- API/core domain service;
- family/access service o modulo deployable separabile;
- worker-core;
- PostgreSQL;
- Redis;
- MinIO o storage S3-compatible locale;
- Keycloak o IdP OIDC locale;
- OpenTelemetry Collector;
- Prometheus;
- Grafana;
- Alertmanager;
- Loki e Tempo, con retention ridotta ma disponibili per troubleshooting;
- scheduler/reconciliation.

OCR, AI, offerte retailer e provider esterni restano capability disattivabili. Il core family release deve funzionare con catalogo manuale/barcode locale, inventory, consumi, soglie, shopping list, QR invite, audit e monitoring.

## Topologia locale

```text
                    +------------------+
                    | Browser / PWA     |
                    +---------+--------+
                              |
                    +---------v--------+
                    | Gateway           |
                    +---------+--------+
                              |
             +----------------+----------------+
             |                                 |
     +-------v--------+               +--------v-------+
     | Web/API         |               | Keycloak OIDC  |
     +-------+--------+               +----------------+
             |
   +---------+----------+----------------+
   |                    |                |
+--v---+          +-----v------+   +-----v-------+
| PG   |          | Redis      |   | MinIO       |
+--+---+          +-----+------+   +-------------+
   |                     |
   |              +------v-------+
   |              | worker-core  |
   |              +--------------+
   |
   +--> outbox/reconciliation/scheduler

+------------------------------------------------------+
| OTel Collector -> Prometheus -> Grafana              |
|                  Loki/Tempo -> Grafana               |
|                  Alertmanager                         |
+------------------------------------------------------+
```

Tutti i container comunicano su una rete privata Docker. Solo gateway, Grafana e gli endpoint amministrativi esplicitamente autorizzati sono pubblicati sull'host. PostgreSQL, Redis, MinIO, Keycloak e collector non sono esposti direttamente alla LAN salvo necessità documentata.

## Vincoli della release famigliare

- niente tenant retailer nell'interfaccia iniziale;
- schema dati predisposto con `tenant_id` nullable/estendibile ma senza complessita B2B prematura;
- famiglia e membership sono il confine di autorizzazione;
- nessun provider cloud e necessario per avviare il core;
- backup su volume/disco esterno sono obbligatori per i dati reali;
- il profilo `family-local` deve avere un comando/documento unico di avvio e verifica;
- dati demo e dati reali devono essere separabili;
- le capability opzionali non devono impedire l'avvio del core.

## Conseguenze

### Positive

- installazione riproducibile su un server domestico;
- privacy e controllo locale per il primo rilascio;
- monitoring completo e debugging realistico;
- core logic separata da provider e container;
- migrazione futura a Kubernetes tramite immagini e contratti invariati.

### Negative

- il server locale resta un single point of failure;
- Keycloak, Grafana e observability consumano risorse;
- backup esterno e gestione aggiornamenti sono responsabilita locali;
- provider OCR/AI/offerte non sono disponibili senza configurazione aggiuntiva.

## Criteri di accettazione architetturale

- `family-local` avvia tutti i servizi fondamentali con health/readiness;
- il core funziona senza rete esterna dopo il pull delle immagini e dei dataset necessari;
- una chiamata segue trace da gateway a PostgreSQL/Redis/worker e Grafana;
- un backup PostgreSQL e MinIO puo essere ripristinato;
- spegnere worker opzionali non interrompe famiglia, inventario o lista;
- ogni container ha resource limit, restart policy e log redatti;
- i manifest/container possono essere mappati a Deployment/StatefulSet in Kubernetes senza cambiare i contratti.
