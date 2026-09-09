# Test kit

Synthetic fixtures, contract harnesses, database test helpers, and deterministic clock/ID
utilities. No production credentials or personal data are allowed here.

## Public primitives

- `FixedClock`: isolated, mutable test time that returns defensive `Date` copies;
- `SequenceIdGenerator`: deterministic cyclic IDs for replay and idempotency tests;
- `createTestContext`: standard clock/ID dependency bundle;
- `createFixtureFactory`: shallow, immutable-default fixture creation;
- `InMemoryHttpClient`: async HTTP boundary for handler/component tests;
- `DatabaseTestAdapter`: transaction/reset contract for real or container-backed adapters;
- `QueueTestAdapter`: publish/receive/ack/reject contract for queue tests.

The package owns test seams and deterministic helpers only. It must not contain domain rules,
production repositories, provider clients, or hidden fallback behavior.
