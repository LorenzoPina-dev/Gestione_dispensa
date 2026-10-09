import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient } from "redis";

test("recovery scans past earlier pending events after a consumer crash", { skip: !process.env.REDIS_URL }, async () => {
  const client = createClient({ url: process.env.REDIS_URL });
  const stream = `test:recovery:${randomUUID()}`;
  const group = "recovery-proof";
  try {
    await client.connect();
    await client.xGroupCreate(stream, group, "0", { MKSTREAM: true });
    const eventIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const eventId of eventIds) {
      await client.xAdd(stream, "*", { event: JSON.stringify({ eventId, eventType: "RecoveryProof" }) });
    }

    const delivered = await client.xReadGroup(group, "crashed-consumer", [{ key: stream, id: ">" }], { COUNT: eventIds.length });
    assert.equal(delivered?.[0]?.messages.length, eventIds.length);

    const recoveredIds: string[] = [];
    const recoveredMessageIds: string[] = [];
    let cursor = "0-0";
    let scans = 0;
    do {
      const recovered = await client.xAutoClaim(stream, group, "recovery-consumer", 0, cursor, { COUNT: 1 });
      for (const message of recovered.messages) {
        if (!message) continue;
        recoveredIds.push(JSON.parse(message.message.event).eventId);
        recoveredMessageIds.push(message.id);
      }
      cursor = recovered.nextId ?? "0-0";
      scans += 1;
    } while (cursor !== "0-0" && scans < 10);

    assert.equal(cursor, "0-0", "recovery scan should finish its pending-entry pass");
    assert.deepEqual(recoveredIds.sort(), [...eventIds].sort());
    for (const messageId of recoveredMessageIds) {
      assert.equal(await client.xAck(stream, group, messageId), 1);
    }
  } finally {
    if (client.isOpen) {
      await client.xGroupDestroy(stream, group).catch(() => undefined);
      await client.del(stream).catch(() => undefined);
      await client.quit();
    }
  }
});
