# Kubernetes layout

Kubernetes is a future deployment target, not a prerequisite for the family-local release.
`base` contains portable workload definitions; overlays own environment-specific replicas,
resources, secrets references, ingress, and policy. No plaintext secret belongs here.

`base` contains stateless API/worker workloads, security policies, probes, PDBs and bounded HPAs.
`overlays/family-local` remains single-replica and local; `overlays/production` starts two
stateless replicas and enables the same bounded autoscaling policy. Database and Redis remain
external/stateful concerns. See [SCL-OPS-002-CAPACITY-EVIDENCE.md](SCL-OPS-002-CAPACITY-EVIDENCE.md)
for the explicit load-test waiver.
