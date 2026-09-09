# Kubernetes layout

Kubernetes is a future deployment target, not a prerequisite for the family-local release.
`base` contains portable workload definitions; overlays own environment-specific replicas,
resources, secrets references, ingress, and policy. No plaintext secret belongs here.
