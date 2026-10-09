# Event delivery recovery

## Delivery guarantees

Each service writes domain changes and its outbox event in the same PostgreSQL transaction. A relay appends the event to the Redis stream, then marks the outbox row published. A crash between those two steps can append a duplicate; consumers must deduplicate by `eventId`.

Inventory, nutrition, shopping, and notifications commit their database work before acknowledging a stream message. Inventory, nutrition, and the two updated workers reclaim idle pending messages with `XAUTOCLAIM`. If processing commits but the ACK is lost, replay is safe because the consumer's `event_consumers` or `processed_events` table rejects a repeated event ID.

Redis uses AOF persistence and a named Docker volume. A complete loss of that volume can still remove entries whose outbox rows are already marked published. Outbox replay covers that case while those source rows are retained.

## Replay after Redis data loss

Replay each service outbox from a timestamp earlier than the suspected loss. The relay runs once and leaves `published_at` unchanged:

```powershell
docker compose run --rm -e REPLAY_SINCE=2026-10-09T00:00:00Z relay-inventory
```

Repeat for the affected producers. To rebuild the shared stream, run the same command for `relay-identity`, `relay-family`, `relay-inventory`, `relay-shopping`, `relay-catalog`, `relay-notifications`, `relay-privacy`, `relay-recipes`, `relay-nutrition`, `relay-stores`, `relay-shelf-life`, and `relay-ocr`. Choose a timestamp before the loss; replaying too narrow a window can leave consumers missing older events.

Replays may append duplicate stream entries. Consumers deduplicate by the stable event ID. Check the relay's `replay_completed` log and each consumer's health/logs after replay.

## Crash recovery proof

With Redis available locally, run the integration proof from PowerShell:

```powershell
$env:REDIS_URL = "redis://localhost:6379"
npm --workspace @gestione-dispensa/worker-shopping test
npm --workspace @gestione-dispensa/worker-notifications test
```

The test writes one event, delivers it to a simulated crashed consumer without acknowledging it, reclaims it as a replacement consumer, checks the event ID, then acknowledges it. It uses unique stream and group names and removes them after the run.

## Retention status

The relays report how many already-published outbox rows are older than 90 days as `retention_review`. They currently retain those rows. Automatic deletion is intentionally withheld until consumer acknowledgement watermarks and archive/restore behavior are defined and verified. The outbox is the recovery source for a lost Redis volume, so deleting it without that proof would shorten recovery silently.
