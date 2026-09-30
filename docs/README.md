# Documentazione tecnica

Questa directory contiene solo la documentazione necessaria per capire, sviluppare e operare l'architettura a microservizi.

## Ordine di lettura

1. ARCHITECTURE.md — topologia, confini, rete e regole.
2. SERVICES.md — responsabilità, porte, storage e dipendenze.
3. DATA.md — ownership dei dati e datastore.
4. FLOWS.md — flussi sincroni e asincroni.
5. API.md — contratto HTTP e Gateway.
6. SECURITY.md — autenticazione, autorizzazione e tenant isolation.
7. OPERATIONS.md — avvio, migration, health e diagnosi.

openapi.yaml è il contratto machine-readable delle API.

La documentazione non deve duplicare codice, configurazioni Docker o schema SQL. Quando cambia l'architettura reale, aggiornare questi documenti ed eliminare documenti temporanei o report di singole sessioni.
