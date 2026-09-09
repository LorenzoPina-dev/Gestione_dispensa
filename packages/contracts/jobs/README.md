# Job schemas

Versioned asynchronous job payloads, state transitions, retry policy, and dead-letter metadata
belong here.

`job.v1.json` is the common status record. Job capability names are registered in
`registry.v1.json`; unknown capabilities must be rejected at submission rather than silently
executed.
