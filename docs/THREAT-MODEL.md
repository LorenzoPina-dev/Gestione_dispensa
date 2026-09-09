# Threat model e security architecture

## 1. Metodo e confini

Il modello usa STRIDE per i flussi principali e considera un deployment domestico, un cluster Kubernetes e un tenant retailer. Il provider esterno, l'utente autenticato, l'operatore e il nodo host sono soggetti con livelli di fiducia diversi.

## 2. Asset

- credenziali, sessioni, chiavi OIDC e secret provider;
- dati household: scorte, consumi, liste, foto, preferenze e profili;
- catalogo, nutrizione, allergeni, offerte e ricette;
- ledger inventario e outbox, cioe stato autorevole e replay;
- job, payload e DLQ;
- audit, log, metriche, trace e configurazioni;
- immagini container, artifact CI/CD e manifest Kubernetes;
- backup e chiavi di cifratura.

## 3. Trust boundaries

1. browser -> gateway;
2. gateway -> API;
3. API -> database/cache/object storage;
4. producer -> broker -> consumer;
5. servizio -> provider esterno;
6. control plane -> runtime/container;
7. tenant household -> tenant retailer/backoffice;
8. application log -> observability backend;
9. production -> backup/storage esterno.

Ogni boundary ha autenticazione, autorizzazione, validazione, timeout, audit o cifratura secondo il flusso.

## 4. Minacce e controlli

| ID | Minaccia | Superficie | Controlli principali | Evidenza |
|---|---|---|---|---|
| T-001 | furto sessione/token | browser/gateway | OIDC PKCE, HttpOnly Secure cookie, CSP, revoca, MFA privilegiata | auth/security test |
| T-002 | cross-household access | API/query/events | ABAC, household scope, RLS defense-in-depth, tenant tests | authorization matrix |
| T-003 | upload malware | foto/allegati | MIME allowlist, size quota, antivirus, EXIF removal, quarantine | upload test |
| T-004 | SSRF | provider URL/import | allowlist host, DNS/IP validation, no internal ranges, egress policy | SSRF test |
| T-005 | prompt injection/data exfiltration | OCR/AI | adapter isolation, content boundary, redaction, no tool access, output validation | AI abuse test |
| T-006 | replay/double movement | API/events | Idempotency-Key, clientOperationId, inbox dedupe, immutable ledger | duplicate test |
| T-007 | poison message | queue | schema validation, retry cap, DLQ, replay scope, alert | DLQ test |
| T-008 | provider compromise | external adapters | least privilege, timeout, circuit breaker, response validation, secret rotation | contract test |
| T-009 | SQL/injection | API/search | parameterized queries, validation, least privilege DB role | SAST/DAST |
| T-010 | XSS/CSRF | web | CSP, output encoding, CSRF token, SameSite, dependency scan | web security test |
| T-011 | secret exposure | CI/log/container | secret manager, scanning, redaction, no secrets in image | secret scan |
| T-012 | supply-chain attack | dependencies/images | lockfiles, signed artifacts, SBOM, Trivy, provenance, review | CI evidence |
| T-013 | Kubernetes escape | runtime | non-root, seccomp, read-only FS, capabilities drop, NetworkPolicy, pod security | cluster scan |
| T-014 | observability data leak | logs/traces | redaction, restricted labels, access roles, retention, no raw payload | log inspection |
| T-015 | backup theft | backup/object storage | encryption, separate credentials, immutable retention, restore audit | restore drill |
| T-016 | abuse/cost explosion | OCR/AI/upload | quota, rate limit, budget, circuit breaker, per-tenant metering | load/abuse test |
| T-017 | admin misuse | backoffice/DLQ | JIT access, least privilege, dual approval for destructive actions, audit append-only | audit review |
| T-018 | tenant re-identification | analytics | k-anonymity thresholds, aggregation, purpose limitation, no cross-tenant training | privacy review |

## 5. Security controls per layer

### Identity

- provider OIDC con configurazione issuer/audience verificata;
- access token breve e refresh revocabile;
- MFA per owner, operatori e backoffice;
- service account separati per API, worker, backup e observability;
- rotazione secret e chiavi senza rebuild dell'immagine.

### API e web

- allowlist route e method;
- schema validation input/output;
- authorization nel caso d'uso, non solo nel gateway;
- rate limit e quota per IP, principal, household e tenant;
- errori generici verso il client;
- CORS esplicito e security headers.

### Dati

- encryption in transit e at rest;
- separazione ruoli DB e schema ownership;
- backup cifrati, chiavi separate e restore verificato;
- audit per accessi privilegiati ed export;
- retention e cancellazione propagata a proiezioni/cache.

### Messaging

- broker non esposto pubblicamente;
- ACL per producer/consumer e coda;
- schema validation, idempotenza, DLQ e replay autorizzato;
- nessun payload sensibile non necessario nell'evento;
- trace context propagato ma non usato come segreto.

### Container e Kubernetes

- immagini minimali e non-root;
- filesystem read-only se possibile;
- resource request/limit e quota per namespace/tenant;
- NetworkPolicy deny-by-default;
- secret via secret manager/operator, mai manifest in chiaro;
- Pod Security Standards, vulnerability scan e admission policy;
- ingress TLS e certificate rotation;
- etcd cifrato e backup quando si usa Kubernetes.

## 6. Incident response

1. rilevare e classificare;
2. contenere senza distruggere evidenze;
3. revocare token/secret compromessi;
4. isolare workload o tenant coinvolto;
5. preservare audit, trace e timeline;
6. eradicare e ruotare credenziali;
7. ripristinare da backup verificato se necessario;
8. validare integrita dati e confini tenant;
9. comunicare secondo obblighi contrattuali/legali;
10. postmortem e remediation tracciata.

## 7. Security acceptance gate

Prima della produzione devono essere completati:

- threat model revisionato a ogni nuova trust boundary;
- SAST, dependency, secret, image e DAST scan;
- test authorization positivo e negativo per ogni endpoint;
- test tenant isolation e data export/erasure;
- test upload, SSRF, rate limit e replay;
- verifica di log redaction;
- rotazione secret simulata;
- restore e incident tabletop;
- scansione manifest Kubernetes e policy admission;
- firma/provenance degli artifact.

## 8. REL-SEC-001 evidence

The first repeatable security gate passed on 2026-09-09:

- production dependency audit reported zero vulnerabilities at every severity;
- authorization checks verified unauthenticated, inactive-membership, and cross-family denial;
- observability checks verified sensitive attribute redaction;
- runtime configuration scan found no concrete secret assignments in scanned files;
- the required SSRF, CSRF, XSS, rate-limit, secret, and authorization controls remain explicitly
  represented in this threat model.

The gate does not claim upload/SSRF runtime coverage, browser DAST, container/image scanning, or
signed-artifact provenance where those surfaces are not implemented. The detailed exceptions and
owners are recorded in `security/REL-SEC-001-REPORT.md`.
