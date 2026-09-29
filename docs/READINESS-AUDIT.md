# Readiness audit

La repository è una baseline microservizi funzionante a livello di struttura e routing, ma non tutte le capability di prodotto sono complete.

## Ready at repository level

- workspace e servizi separati;
- Gateway + Nginx boundary;
- service-specific Dockerfiles;
- PostgreSQL migrations e schema ownership;
- Composite Views;
- worker/scheduler boundaries;
- shared contracts/config/observability packages.

## Evidence still required

- end-to-end auth and family isolation;
- PostgreSQL RLS tests;
- complete OCR human review flow;
- atomic OCR confirmation;
- normalized pricing;
- unit conversion;
- nutrition calculation;
- WebSocket family broadcast;
- real push delivery;
- offline conflict merge;
- uniform audit/restore;
- full Compose build and E2E run.

Il progetto non viene dichiarato production-ready finché questi gate non hanno evidenza ripetibile.
