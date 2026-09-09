import assert from "node:assert/strict";
import test from "node:test";
import { RedisQueueAdapter, type RedisQueueClient } from "./redis-queue.js";
import type { QueueMessage } from "./queue.js";

class FakeRedis implements RedisQueueClient {
  private readonly lists = new Map<string, string[]>();

  public async lPush(key: string, value: string): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.unshift(value);
    this.lists.set(key, list);
    return list.length;
  }

  public async brPopLPush(source: string, destination: string): Promise<string | null> {
    const sourceList = this.lists.get(source) ?? [];
    const value = sourceList.pop() ?? null;
    if (value === null) return null;
    this.lists.set(source, sourceList);
    await this.lPush(destination, value);
    return value;
  }

  public async lRem(key: string, count: number, value: string): Promise<number> {
    const list = this.lists.get(key) ?? [];
    const index = list.indexOf(value);
    if (index < 0) return 0;
    list.splice(index, count);
    return 1;
  }

  public async lLen(key: string): Promise<number> {
    return (this.lists.get(key) ?? []).length;
  }

  public async lIndex(key: string, index: number): Promise<string | null> {
    const list = this.lists.get(key) ?? [];
    return index === -1 ? (list.at(-1) ?? null) : (list[index] ?? null);
  }

  public async lRange(key: string, start: number, stop: number): Promise<readonly string[]> {
    const list = this.lists.get(key) ?? [];
    return list.slice(start, stop < 0 ? undefined : stop + 1);
  }
}

function message(id: string, enqueuedAt: number): QueueMessage<{ jobId: string }> {
  return { id, queue: "core", payload: { jobId: id }, enqueuedAt };
}

test("Redis queue preserves FIFO delivery and acknowledges processing entries", async () => {
  const queue = new RedisQueueAdapter(new FakeRedis(), "core", 0);
  await queue.publish(message("first", 100));
  await queue.publish(message("second", 200));

  assert.equal((await queue.receive())?.id, "first");
  assert.equal((await queue.receive())?.id, "second");
  await queue.ack("second");
  await queue.ack("first");
  assert.equal(await queue.size(), 0);
});

test("Redis queue nack requeues the exact message and reports oldest age", async () => {
  const queue = new RedisQueueAdapter(new FakeRedis(), "core", 0);
  await queue.publish(message("first", 100));
  await queue.publish(message("second", 200));
  const received = await queue.receive();
  assert.equal(received?.id, "first");
  await queue.nack("first");
  assert.equal(await queue.size(), 2);
  assert.equal(await queue.oldestEnqueuedAt(), 100);
});
