# Repository structure

```
services/
  gateway/
  service-identity/
  service-family/
  service-inventory/
  service-shopping/
  service-catalog/
  service-notifications/
  service-privacy/
  service-jobs/
  service-recipes/
  service-nutrition/
  service-stores/
  service-shelf-life/
  service-ocr/
  off-lookup/
  worker-core/
  worker-ocr/
  worker-shelf-life/
  worker-off-sync/
  worker-notifications/
  worker-integrations/
  scheduler/
  search-indexer/
```

Ogni servizio possiede package, configurazione, source, migration e database layer propri. I package condivisi contengono solo librerie tecniche/contratti e non domain ownership condivisa.
