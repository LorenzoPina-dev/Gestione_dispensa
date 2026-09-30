# Domain events

Events are versioned and include `eventId`, `eventType`, `version`, `occurredAt`, `producer`, `correlationId` and a domain payload.

Core events:

- `family.invitation.created.v1`
- `family.member.joined.v1`
- `product.resolved.v1`
- `vision.recognition.completed.v1`
- `inventory.item.added.v1`
- `inventory.item.consumed.v1`
- `inventory.item.wasted.v1`
- `inventory.item.deleted.v1`
- `inventory.low_stock.v1`
- `expiration.estimated.v1`
- `expiration.threshold_reached.v1`
- `shopping.item.created.v1`
- `shopping.completed.v1`
- `offer.updated.v1`
- `notification.requested.v1`
- `media.uploaded.v1`

Consumers must be idempotent. Event processing must tolerate retries and out-of-order delivery where the domain permits it.
