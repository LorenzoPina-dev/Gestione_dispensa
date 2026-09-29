# Architecture

## 1. Runtime topology

```text
                    ┌──────────────────────┐
                    │      Browser/PWA      │
                    └──────────┬───────────┘
                               │ HTTPS
                               ▼
                    ┌──────────────────────┐
                    │       Nginx           │
                    │ TLS + reverse proxy  │
                    └──────┬─────────┬─────┘
                           │         │
                    /api/v1/*       /
                           │         │
                           ▼         ▼
                    ┌──────────┐  ┌──────────┐
                    │ Gateway  │  │   Web    │
                    │   BFF    │  │ React    │
                    └────┬─────┘  └──────────┘
                         │
        ┌────────────────┼──────────────────────────────┐
        ▼                ▼                              ▼
  Core domain       Extended domain                 Async
  services          services                         workers
```

Il Gateway è un boundary HTTP: autentica il bearer token, instrada le API e costruisce le Composite Views. Non possiede dati di dominio.

## 2. Service boundaries

| Service | Responsabilità | Storage | Comunicazione |
|---|---|---|---|
| Identity | OIDC, profilo, registrazione | `public` | HTTP/Gateway |
| Family | nuclei, membership, inviti | `public` | HTTP/Gateway |
| Inventory | location, stock, lots, movements | `public` | HTTP + eventi/job |
| Shopping | liste, articoli, restock | `public` | HTTP + Inventory |
| Catalog | prodotti, barcode, provenance | `public` | HTTP + OFF Lookup |
| Notifications | notifiche, read state | `public` | HTTP + worker |
| Privacy | consensi, export, erasure | `public` | HTTP + job |
| Jobs | amministrazione dello stato dei job | `public` | HTTP + queue |
| Recipes | ricette, suggerimenti, cooking | `recipes_domain` | HTTP + Inventory/Shopping |
| Nutrition | diario, target, summary | `nutrition_domain` | HTTP + job |
| Stores | negozi, prezzi, storico | `stores_domain` | HTTP + OCR |
| Shelf-Life | regole e predizioni | `shelf_life_domain` | HTTP + worker |
| OCR | receipt jobs e review drafts | `ocr_domain` | HTTP + worker |
| OFF Lookup | cache OpenFoodFacts | MongoDB | HTTP + queue |
| Web | esperienza utente | none | HTTP Gateway |

## 3. Ownership rules

1. Un dominio ha un solo owner applicativo.
2. Nessun servizio importa sorgenti TypeScript di un altro servizio.
3. Le chiamate sincrone cross-service passano da HTTP.
4. Gli effetti asincroni passano da queue/event contracts.
5. Il Gateway aggrega ma non implementa business logic di dominio.
6. PostgreSQL è la source of truth transazionale.
7. MongoDB è una cache/catalog read model e può essere ricostruito.
8. MinIO contiene blob e allegati; i riferimenti ai blob sono dati di dominio.
9. La UI non conosce host/porte interne dei servizi.

## 4. Authentication and authorization

```text
Browser
  │ Bearer JWT
  ▼
Nginx
  ▼
Gateway
  │ verify issuer/audience/signature
  ▼
owning service
  │ verify principal + family membership + role
  ▼
PostgreSQL transaction
```

La verifica del JWT al Gateway protegge il perimetro. Ogni servizio deve comunque applicare la propria authorization sul resource/family scope.

## 5. Multi-tenant boundary

Ogni richiesta tenant-scoped porta il `familyId` logico e il principal autenticato. L'obiettivo del database è applicare lo stesso confine con PostgreSQL RLS; la documentazione di sicurezza distingue esplicitamente authorization applicativa e database isolation.

## 6. Sync vs async

Sincrono:

- login/profile/family membership;
- CRUD catalogo;
- letture e mutazioni dispensa;
- liste spesa;
- CRUD ricette;
- prediction shelf-life veloce.

Asincrono:

- OCR;
- enrichment OpenFoodFacts;
- raffinamento shelf-life;
- notifiche;
- reconciliation;
- projection/search rebuild;
- calcolo nutrizionale quando non necessario per la risposta interattiva.

## 7. Failure model

Il browser riceve errori uniformi dal Gateway. Un servizio non disponibile non deve bloccare l'intero sistema salvo quando è una dipendenza obbligatoria della mutazione corrente. Le Composite Views possono restituire sezioni degradate solo quando il contratto della schermata lo consente.
