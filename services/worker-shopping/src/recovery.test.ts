import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient } from "redis";

test("an unacknowledged event is reclaimed after a consumer crash", { skip: !process.env.REDIS_URL }, async () => {
  const client = createClient({ url: process.env.REDIS_URL });
  const stream = `test:recovery:${randomUUID()}`;
  const group = "recovery-proof";
  try {
    await client.connect();
    await client.xGroupCreate(stream, group, "0", { MKSTREAM: true });
    const eventId = randomUUID();
    await client.xAdd(stream, "*", { event: JSON.stringify({ eventId, eventType: "RecoveryProof" }) });

    const delivered = await client.xReadGroup(group, "crashed-consumer", [{ key: stream, id: ">" }], { COUNT: 1 });
    assert.equal(delivered?.[0]?.messages.length, 1);

    const reclaimed = await client.xAutoClaim(stream, group, "recovery-consumer", 0, "0-0", { COUNT: 1 });
    assert.equal(reclaimed.messages.length, 1);
    assert.equal(JSON.parse(reclaimed.messages[0]!.message.event).eventId, eventId);
    assert.equal(await client.xAck(stream, group, reclaimed.messages[0]!.id), 1);
  } finally {
    if (client.isOpen) {
      await client.xGroupDestroy(stream, group).catch(() => undefined);
      await client.del(stream).catch(() => undefined);
      await client.quit();
    }
  }
});
