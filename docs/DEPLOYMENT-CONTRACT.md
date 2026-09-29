# Deployment contract

## Local

```text
https://<host>:8443/
```

Nginx è l'entry point. Web, Gateway e servizi applicativi comunicano sulla rete privata.

## Deployment order

1. PostgreSQL/Redis/Keycloak/MinIO;
2. migration runner;
3. domain services;
4. workers/scheduler;
5. Gateway;
6. Web;
7. Nginx.

## Release checks

- migration status/checksum;
- health/readiness;
- contract tests;
- security checks;
- E2E attraverso Nginx;
- backup age e restore evidence;
- queue/DLQ health.
