# SCL-OPS-002 capacity evidence

The Kubernetes base defines bounded HPA policies for API and `worker-core`. API scaling uses CPU;
worker scaling combines CPU with the `worker_backlog` external metric emitted by the queue
observability integration. Scale-up is bounded to 100% per minute and scale-down is deliberately
slower to avoid retry storms and duplicate side effects.

The production overlay starts both stateless workloads at two replicas. The family-local overlay
keeps one replica and does not claim HA.

The load test required to calibrate p95/backlog thresholds is not executable in this environment
because no Kubernetes API or metrics adapter is available. This is an explicit `OPS` waiver, not
a claim that the configured thresholds are production-validated. Before production approval,
record a load run with API p95, worker backlog, duplicate-side-effect count, household-isolation
checks, and scale-up/scale-down timestamps.
