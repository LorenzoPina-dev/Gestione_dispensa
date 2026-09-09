# SCL-REL-001 production readiness record

Snapshot: 2026-09-09. Decision: **NOT APPROVED for production**.

## Evidence matrix

| Prerequisite | Evidence | Status | Owner / exit |
|---|---|---|---|
| Multi-node stateless deployment | `infra/kubernetes/overlays/production` with two replicas and bounded HPA | PARTIAL | OPS: execute cluster rollout and disruption drill |
| PostgreSQL/Redis durable state | migrations, backup manifest, restore runbook | PARTIAL | OPS: execute real restore and failover drill |
| Secret rotation | secret references in Kubernetes and typed config | PARTIAL | OPS: perform rotation without rebuild |
| TLS/DNS/certificate lifecycle | deployment contract only | WAIVED | OPS: configure environment ingress before production |
| Artifact signing/SBOM | security follow-up exception | WAIVED | OPS: add signed CI artifacts and SBOM |
| Disaster recovery | backup/restore tests and isolated-target helper | PARTIAL | OPS: record RTO/RPO with real services |
| SLO and alert delivery | SLO definitions, runbooks, synthetic p95 | PARTIAL | OPS: run metrics-backed load and alert drill |
| Tenant/family isolation | authorization policy, projection and negative tests | PASS at code boundary | IDN/API: repeat with deployed services |
| Privacy and erasure | retention policy and traceability blockers | BLOCKED | PLT: implement export/erasure and obtain DPO approval |

## Required approval conditions

Production approval requires every `PARTIAL`, `WAIVED` and `BLOCKED` row to have repeatable
evidence or a dated exception signed by the accountable owner. A single host remains explicitly
non-HA even when Kubernetes restarts workloads.

## Operator handoff

The handoff set is:

- [RUNBOOKS.md](RUNBOOKS.md);
- [SLO-ERROR-BUDGET.md](SLO-ERROR-BUDGET.md);
- [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md);
- [TRACEABILITY.md](TRACEABILITY.md);
- [SCL-OPS-002-CAPACITY-EVIDENCE.md](../infra/kubernetes/SCL-OPS-002-CAPACITY-EVIDENCE.md).

No production credential, token, provider response or personal data is included in this record.
