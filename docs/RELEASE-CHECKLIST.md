# Release readiness checklist

Record: `REL-GOV-001`, snapshot 2026-09-09.

## Decision

**NOT APPROVED for beta or production.** The traceability register contains explicit `PARTIAL`
and `OUT_OF_SCOPE` requirements, and family-local Docker-dependent drills remain waived.

## Evidence reviewed

- [TRACEABILITY.md](TRACEABILITY.md): every `MUST` requirement has status and owner/follow-up;
- [THREAT-MODEL.md](THREAT-MODEL.md): trust boundaries and security gate evidence;
- [RETENTION-AND-DATA-LIFECYCLE.md](RETENTION-AND-DATA-LIFECYCLE.md): retention and erasure policy;
- [REL-SEC-001 report](../security/REL-SEC-001-REPORT.md): security gate and exceptions;
- [REL-OPS-001 report](../ops/REL-OPS-001-REPORT.md): SLO evidence and operational waivers;
- [PRODUCTION-READINESS-SCL-REL-001](PRODUCTION-READINESS-SCL-REL-001.md): final production
  prerequisite matrix and operator handoff;
- [RUNBOOKS.md](RUNBOOKS.md): incident and recovery procedures.

## Blocking follow-up

| Blocker | Owner | Exit evidence |
|---|---|---|
| real OIDC, Compose health and alert drill | IDN/OPS | repeatable family-local run |
| export/erasure and consent workflow | PLT | privacy test and audit evidence |
| complete web/PWA core journeys and WCAG evidence | WEB/TST | browser E2E and accessibility report |
| real PostgreSQL/Redis integration and controller coverage | API/OPS | integration suite |
| SSRF/upload/DAST/container and signed-artifact scans | OPS/INT | security report with no critical/high findings |

## Approval record

| Review | Status | Required approver |
|---|---|---|
| Product | PENDING | Product owner |
| Architecture | PENDING | Platform architect |
| Security | PENDING | Security reviewer |
| Privacy | PENDING | Privacy/DPO reviewer |
| Operations | PENDING | SRE/operations owner |
| QA/accessibility | PENDING | QA owner |

No approval is implied by this document; it records the current gate decision and required
evidence.
