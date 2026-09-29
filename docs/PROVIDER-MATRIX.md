# Matrice provider e integrazioni

> **Nota di allineamento (2026-09-26):** questa matrice descrive categorie di provider generiche e
> non ancora vincolate a un'implementazione concreta, con un'eccezione: la capability "catalogo"
> ha oggi un adapter reale e cablato, `services/off-lookup`, descritto nella sezione 1bis sotto.
> Le altre righe restano pianificazione.

## 1. Regola

Ogni provider e un adapter sostituibile. La scelta definitiva richiede verifica di paese, licenza, DPA, costi, SLA e dati trasferiti. I default sotto sono categorie, non contratti firmati.

| Capability | Opzione home-small | Opzione production | Input | Output | Fallback |
|---|---|---|---|---|---|
| OIDC | Keycloak locale Docker | provider enterprise o Keycloak HA | auth code/PKCE | claims/session | accesso core indisponibile fail-closed |
| barcode local | ZXing/ML Kit client | stesso + catalog provider | camera/code | normalized barcode | manuale |
| catalogo | Open Food Facts se licenza/cobertura | feed/API contrattuale + cache | barcode/SKU | product/provenance | create manual |
| OCR | disabilitato o provider budget-limited | provider DPA/region-compliant | quarantined asset | candidates/confidence | manuale |
| vision/AI | disabilitato | provider isolato con budget | redacted image/text | proposal | review/manual |
| nutrition | dataset con licenza verificata | provider/dataset contrattuale | product/portion | nutrient profile | unknown |
| ricette | dataset verificato | provider/licensed content | inventory/preferences | ranked recipes | no suggestions |
| offerte | import manuale/feed autorizzato | API/feed retailer | retailer/area | valid offers | stale/none |
| notifications | in-app/email | email/push provider | event/preferences | delivery status | in-app |
| object storage | MinIO locale Docker | managed S3 with versioning | bytes + metadata | object ref | no upload |

## 1bis. Adapter concreto gia implementato: `services/off-lookup`

A differenza delle altre capability in tabella, la risoluzione barcode/catalogo tramite Open Food
Facts non e piu solo una categoria pianificata: esiste un microservizio standalone dedicato,
`services/off-lookup` (Express + MongoDB), gia cablato in `docker-compose.yml`.

- **Pattern**: read-through cache. Ordine di risoluzione: (1) dump MongoDB locale di Open Food
  Facts (`openfoodfacts-mongodbdump` alla radice del repo, importato in locale), (2) fallback su
  API live Open Food Facts v3 (`OFF_LOOKUP_API_BASE_URL`, default `https://world.openfoodfacts.org`)
  quando il dump locale non ha il barcode, con auto-healing della cache locale sui risultati
  live.
- **Consumo**: `service proprietario` chiama `off-lookup` via HTTP (`OFF_LOOKUP_BASE_URL`,
  `OFF_LOOKUP_TIMEOUT_MS`) da `services/catalog/external-barcode-client.ts` per l'arricchimento
  catalogo durante il lookup barcode.
- **Degradazione**: deliberatamente **non** un health-gate Compose (`off-lookup` non e in
  `depends_on` dell'api) — se il servizio e assente o non risponde entro il timeout, la
  risoluzione barcode degrada semplicemente a inserimento manuale, senza bloccare il resto
  dell'API.
- **Cosa manca ancora rispetto alla scheda obbligatoria sotto**: nessuna scheda formale di
  legal entity/licenza/DPA e stata ancora compilata per questo adapter; Open Food Facts e un
  dataset con licenza Open Database License (ODbL), da verificare esplicitamente prima di un uso
  in produzione con utenti reali al di fuori del contesto family-local.

## 2. Scheda obbligatoria per provider

Prima dell'attivazione compilare:

- legal entity e paese;
- dati inviati, classificazione e finalita;
- storage/transfer location;
- DPA/subprocessor e retention;
- licenza contenuti e diritto di caching;
- autenticazione, rotation e scopes;
- rate limit, quota, pricing e budget cap;
- timeout, retry/429, circuit breaker e SLA;
- response schema e versioning;
- accuracy/confidence e casi limite;
- fallback e comportamento degraded;
- metriche, alert e owner;
- procedura di revoca/sostituzione.

## 3. Adapter contract

Ogni adapter espone:

```text
capability()
health()
validateInput()
execute(command, context)
normalize(response)
classifyError(error)
redactForTelemetry()
quotaStatus()
```

`context` include `traceId`, `familyScope` se necessario, `consentPurpose`, deadline, idempotency key e provider policy. L'adapter non puo scrivere direttamente il dominio: restituisce risultato normalizzato al servizio proprietario.

## 4. Contratto normalizzato

```json
{
  "provider": "provider-id",
  "providerRequestId": "opaque",
  "sourceObservedAt": "timestamp",
  "quality": "VERIFIED|IMPORTED|ESTIMATED|UNKNOWN",
  "confidence": 0.0,
  "data": {},
  "warnings": [],
  "retryable": false,
  "traceId": "hex"
}
```

Nessun provider puo sovrascrivere un dato manuale confermato senza workflow di review.

## 5. Selezione e benchmark

Il provider e approvato quando supera contract test, rate-limit test, privacy review, costo massimo, failure test e quality baseline. I risultati sono registrati in una decisione versionata. Cambiare provider non modifica API/eventi del dominio.
