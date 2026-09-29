# Repository structure

```text
.
├── services/
│   ├── gateway/
│   ├── web/
│   ├── service-identity/
│   ├── service-family/
│   ├── service-inventory/
│   ├── service-shopping/
│   ├── service-catalog/
│   ├── service-notifications/
│   ├── service-privacy/
│   ├── service-jobs/
│   ├── service-recipes/
│   ├── service-nutrition/
│   ├── service-stores/
│   ├── service-shelf-life/
│   ├── service-ocr/
│   ├── off-lookup/
│   ├── worker-core/
│   ├── worker-ocr/
│   ├── worker-shelf-life/
│   ├── worker-off-sync/
│   ├── worker-notifications/
│   ├── worker-integrations/
│   ├── scheduler/
│   └── search-indexer/
│
├── packages/
│   ├── contracts/
│   ├── config/
│   ├── domain/
│   ├── observability/
│   ├── testkit/
│   └── ui/
│
├── infra/
│   ├── nginx/
│   ├── compose/
│   ├── postgres/
│   ├── identity/
│   ├── storage/
│   ├── observability/
│   └── kubernetes/
│
├── docs/
├── e2e/
├── ops/
├── security/
└── tools/
```

## Service layout

Un servizio applicativo segue, dove applicabile:

```text
services/<service>/
├── src/
│   ├── <domain>/        # dominio e persistence boundary
│   ├── http/            # router/controller
│   ├── server.ts        # bootstrap HTTP
│   └── tests/            # test del servizio
├── Dockerfile
├── package.json
├── tsconfig.json
└── README.md
```

I worker separano `queue`, `handler`, `repository` e `run` per rendere testabile il ciclo consume → effect → ack.

## Navigation rules

- leggere `README.md` per il runtime globale;
- leggere `docs/SERVICE-CATALOG.md` per trovare un servizio;
- leggere `docs/API-ENDPOINT-CATALOG.md` per trovare una route;
- leggere `docs/DATABASE-ARCHITECTURE.md` per capire ownership e storage;
- leggere `docs/DATA-FLOWS-UI-CONTRACTS.md` per un flusso end-to-end;
- leggere `docs/CURRENT-IMPLEMENTATION-STATUS.md` prima di assumere che una capability sia completa.
