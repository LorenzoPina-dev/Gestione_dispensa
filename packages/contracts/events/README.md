# Event schemas

One JSON Schema per versioned event type belongs here. Producers and consumers validate against
the same immutable schema; incompatible changes require a new event version.

The envelope is `envelope.v1.json`. Household-scoped events must include `householdId`; raw QR
tokens, fallback codes, images, prompts, and unnecessary personal data are prohibited. The
runtime boundary helper `validateEventEnvelope` performs the minimum fail-closed checks before a
consumer reaches domain logic.
