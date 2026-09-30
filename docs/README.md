# Documentazione tecnica

Documentazione canonica e compatta dell'architettura a microservizi.

## Ordine di lettura
1. ARCHITECTURE.md — topologia e regole.
2. SERVICES.md — servizi, ownership e dipendenze.
3. DATA.md — datastore e ownership dati.
4. FLOWS.md — flussi principali.
5. API.md — API e Gateway.
6. SECURITY.md — sicurezza e tenant isolation.
7. OPERATIONS.md — avvio, health e diagnosi.

`openapi.yaml` è il contratto machine-readable delle API.

La documentazione non deve duplicare codice, Docker Compose o SQL. Documenti temporanei, report di sessione, checklist duplicate e informazioni derivabili dal codice non fanno parte della documentazione canonica.