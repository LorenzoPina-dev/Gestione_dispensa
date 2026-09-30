# Architettura

## Topologia
```text
Browser/PWA → Nginx :8443
                 ├→ Web
                 ├→ /api/* → Gateway :3300
                 └→ /realms/* → Keycloak
                                │
                                ▼
                             Gateway
                                │
                  ┌─────────────┼─────────────┐
                  ▼             ▼             ▼
             servizi dominio  OFF Lookup    Workers
                  │             │             │
                  └────── PostgreSQL ─────────┘
                                │
                           Redis / MinIO
```

Nginx è l'unico edge browser; Gateway è l'unico edge API. I servizi interni non sono API pubbliche.

## Regole fondamentali
- ogni bounded context ha processo, route e ownership propri;
- un servizio scrive solo il proprio dominio;
- nessun import TypeScript tra servizi;
- cross-service sincrono tramite HTTP;
- lavoro lungo/retryable tramite job/queue e worker;
- Gateway autentica, instrada e aggrega, ma non contiene business logic;
- PostgreSQL è source of truth transazionale;
- MongoDB è solo cache/read-through OpenFoodFacts;
- MinIO contiene blob, PostgreSQL metadata/ownership;
- il browser non conosce host/porte interne.

## Authentication
```text
Browser → Nginx → Gateway → servizio owner → PostgreSQL
             └──────── Keycloak/OIDC
```
Gateway verifica JWT issuer/audience/firma. Il servizio owner verifica principal, family scope e ruolo.

## Tenant
Le risorse familiari sono scoped tramite `familyId`. Authorization applicativa e, quando abilitato, PostgreSQL RLS forniscono l'isolamento.

## Sincrono / asincrono
Sincrono: auth, famiglie, dispensa, catalogo, spesa, ricette e mutazioni rapide.
Asincrono: OCR, enrichment OFF, shelf-life refinement, notifiche, reconciliation, indicizzazione e manutenzioni.

## Resilienza
Un errore di un servizio non deve abbattere il sistema salvo dipendenze obbligatorie della mutazione. Le Composite Views possono degradare sezioni quando il contratto lo permette.