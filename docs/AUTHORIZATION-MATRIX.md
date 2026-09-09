# Matrice di autorizzazione

## 1. Regole

Autenticazione e autorizzazione sono distinte. Il gateway autentica e costruisce il principal; il servizio proprietario verifica resource scope, family membership, ruolo, stato e finalita. Il default e deny.

Legenda: `R` read, `W` write, `A` administer, `-` denied.

## 2. Ruoli famiglia

| Risorsa/azione | CREATOR | ADMIN | MEMBER | VIEWER | PENDING |
|---|---:|---:|---:|---:|---:|
| vedere famiglia/membri base | R | R | R | R | limited |
| creare famiglia | A | - | - | - | - |
| creare/revocare invito | A | A | - | - | - |
| accettare invito | own | own | own | own | own |
| cambiare ruolo | A | A* | - | - | - |
| rimuovere membro | A | A* | - | - | - |
| modificare impostazioni famiglia | A | W* | - | - | - |
| cancellare famiglia | A + confirm | - | - | - | - |
| leggere scorte | R | R | R | R | - |
| creare/modificare scorte | W | W | W | - | - |
| registrare consumo/spreco | W | W | W | - | - |
| leggere lista spesa | R | R | R | R | - |
| modificare lista spesa | W | W | W | - | - |
| esportare dati famiglia | A | - | own/limited | - | - |
| accedere dati personali altrui | - | - | - | - | - |

`*` escluso auto-promozione, rimozione creator, escalation non consentita e azioni soggette a policy.

## 3. Scope di risorsa

Ogni decisione include:

```text
principal.userId
principal.tenantId?
principal.familyId attiva
resource.familyId
resource.ownerId?
action
role
membership.status
policyVersion
consentPurpose?
```

Una richiesta con family context assente o incoerente viene rifiutata. Il cambio famiglia invalida cache di autorizzazione e query client.

## 4. Operator e tenant

| Area | Platform operator | Catalog operator | Tenant admin | Store manager | Support |
|---|---:|---:|---:|---:|---:|
| health/metrics tecniche | A | - | limited | - | - |
| log applicativi redatti | A | - | own tenant | own store | limited |
| audit sicurezza | A | - | own tenant | own store | read case |
| catalogo canonico | - | A | propose | - | - |
| offerte retailer | - | A | A own tenant | propose | - |
| gestione utenti tenant | - | - | A own tenant | - | - |
| accesso dati famiglia | break-glass auditato | - | aggregate only | aggregate only | case-scoped |
| replay DLQ | A + approval | catalog scope | own tenant scope | own store scope | - |
| modifica policy globali | A + change approval | - | - | - | - |

Support e operatori non devono avere accesso ordinario ai dati alimentari personali. Break-glass richiede motivo, durata, approvazione e audit.

## 5. Endpoint matrix

| Endpoint/capability | Auth | Scope | Ruoli |
|---|---|---|---|
| `POST /families` | OIDC | user | authenticated |
| `POST /families/{id}/invites` | OIDC | family | creator/admin |
| `POST /family-invites/resolve` | none + rate limit | opaque token | public limited |
| `GET /family-invites/{attempt}/review` | OIDC/session | join attempt | attempt owner |
| `POST /family-invites/{attempt}/accept` | OIDC | attempt + target family | attempt owner |
| `POST /families/{id}/activate` | OIDC | membership | active member |
| `POST /inventory/items` | OIDC | family | creator/admin/member |
| `POST /inventory/items/{id}/movements` | OIDC | family/resource | creator/admin/member |
| `GET /shopping-lists/active` | OIDC | family | all active members |
| `POST /shopping-lists/{id}/items` | OIDC | family | creator/admin/member |
| `GET /jobs/{id}` | OIDC | job family/owner | authorized family |
| `POST /admin/dlq/{id}/replay` | OIDC + operator | tenant/capability | platform/catalog scoped |

## 6. Special policy decisions

### QR invite

`resolve` puo essere pubblico ma deve avere rate limit, body limit, generic response, no family enumeration e no token in log. Review/accept richiedono sessione autenticata. Il token non sostituisce OIDC.

### Export and erasure

Export family richiede creator e conferma forte. Export personale puo essere richiesto dall'utente. Erasure e asincrono, auditato e non deve alterare ledger storico oltre la policy: si anonimizza dove la conservazione e obbligatoria.

### Audit/log

Accesso ai log non concede accesso ai dati di dominio. Audit e append-only e filtrato per ruolo. Nessuna autorizzazione viene concessa solo perche un utente conosce un UUID.

## 7. Error contract

- `401 UNAUTHENTICATED`: sessione assente/invalidata;
- `403 FORBIDDEN`: principal valido ma azione non consentita;
- `404 NOT_FOUND_OR_NOT_VISIBLE`: risorsa inesistente o non visibile;
- `409 MEMBERSHIP_CONFLICT`: stato concorrente/idempotenza;
- `429 RATE_LIMITED`: quota superata;
- `451 CONSENT_REQUIRED`: finalita non consentita;
- `503 AUTHZ_DEPENDENCY_UNAVAILABLE`: non fail-open per mutazioni.

## 8. Test obbligatori

- matrix test per ogni endpoint e ruolo;
- test cross-family e cross-tenant negativi;
- test cache invalidation dopo ruolo/rimozione;
- test QR enumeration/rate limit/replay;
- test break-glass e audit;
- test export/erasure per proiezioni;
- test service account con scope minimo;
- test policy version rollback.
