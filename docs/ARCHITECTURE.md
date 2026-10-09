# Architettura

## Confini

Il deployment locale usa NGINX come unico ingresso browser su HTTPS `:8443`. NGINX serve la SPA, inoltra `/api` al Gateway e `/realms` a Keycloak. Il Gateway ascolta internamente su `:3300`, verifica il token e instrada verso il servizio owner. I servizi interni non pubblicano porte host.

Ogni dominio applicativo ha un processo e un database logico PostgreSQL dedicato. Il cluster PostgreSQL è condiviso come infrastruttura; ruoli, database e migration separano i contesti. I servizi non devono scrivere direttamente nei database degli altri.

## Runtime effettivo

Il Compose corrente include servizi HTTP, worker, relay outbox e processi one-shot, oltre all'infrastruttura di supporto. Redis ha due funzioni: stream di eventi di dominio e code di job. I relay leggono gli outbox PostgreSQL e pubblicano su Redis Streams. Il deployment Compose corrente non contiene Kafka.

OpenSearch indicizza i prodotti Open Food Facts per la ricerca testuale; MongoDB conserva il corpus/cache OFF. Catalog PostgreSQL rimane la fonte per prodotti applicativi e provenance. Food Semantics possiede ontologia, label, mapping e cache semantica. LibreTranslate è backend di traduzione configurato via rete egress.

MinIO conserva oggetti come immagini/ricevute quando la funzione è configurata; PostgreSQL conserva metadati e stati. Prometheus, Grafana, Loki, Tempo, Alloy, OTel Collector e cAdvisor supportano metriche, log e trace.

## Topologia

Vedere [Diagrammi tecnici](DIAGRAMS.md#architettura-di-runtime) per il diagramma end-to-end e [SERVICES.md](SERVICES.md) per la distinzione tra componenti sempre attivi e job di inizializzazione.

Le reti Compose sono `edge`, `backend`, `data` ed `egress`: la UI è sulla rete edge; i servizi applicativi sulla rete backend; i datastore sulla rete data; solo componenti che richiedono provider esterni usano egress.

## Regole di dipendenza

- Il browser comunica solo con NGINX.
- Il Gateway instrada richieste e può comporre letture, ma le regole di dominio restano nel servizio owner.
- Le chiamate tra servizi passano dalle API interne/contratti; non si condividono repository DB.
- Le transazioni di dominio registrano outbox nella stessa transazione delle modifiche, quando il dominio pubblica eventi.
- I relay outbox consegnano gli eventi a Redis Streams; i consumer devono tollerare retry e duplicati.
- Job durevoli e tentativi risiedono nel database Jobs; Redis fornisce trasporto/accodamento a bassa latenza.
- MongoDB, Redis, MinIO e OpenSearch non sostituiscono la source of truth transazionale PostgreSQL.
- Un dato stimato (per esempio una scadenza) deve rimanere distinguibile da un valore dichiarato dall'utente.

## Ricerca prodotti e semantica

La ricerca OFF attraversa Catalog e `off-lookup`; OpenSearch serve la ricerca locale, MongoDB conserva i documenti di origine/cache e Open Food Facts è il fallback esterno. La risoluzione barcode selezionata passa poi dall'endpoint Catalog, che persiste prodotto e identificatori nel database applicativo.

Food Semantics risolve label e identità condivise da prodotti, ricette e liste. FoodOn costituisce la sorgente ontologica; LibreTranslate aiuta nella conversione linguistica. Una traduzione lessicale da sola non prova equivalenza semantica: confidenza e mapping persistito sono parte del risultato.

## Autenticazione

Il browser usa OIDC con Keycloak. Gateway verifica issuer, audience e firma; i servizi owner applicano il controllo del contesto utente/famiglia e del ruolo richiesto. Le chiamate interne protette usano token di servizio. La descrizione completa è in [SECURITY.md](SECURITY.md).
