import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const shoppingUrl = process.env.SHOPPING_TEST_URL ?? "http://127.0.0.1:3313";
const familyUrl = process.env.SHOPPING_TEST_FAMILY_URL ?? "http://127.0.0.1:3311";
const databaseUrl = process.env.SHOPPING_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("SHOPPING_TEST_DATABASE_URL is required. Integration uses real Shopping, real Family and real PostgreSQL.");

const pool = new Pool({ connectionString: databaseUrl });
const userId = randomUUID();
const familyName = "shopping-integration-" + Date.now() + "-" + randomUUID().slice(0, 8);
let familyId: string | undefined;
let listId: string | undefined;
let itemId: string | undefined;
let itemVersion = 1;

async function request(base: string, path: string, init?: RequestInit) {
  const response = await fetch(base + path, init);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) as Record<string, any> : undefined };
}
function headers() {
  return { "x-user-id": userId, "x-family-id": familyId ?? "" };
}

before(async () => {
  assert.equal((await request(shoppingUrl, "/health/ready")).response.status, 200);
  assert.equal((await request(familyUrl, "/health/ready")).response.status, 200);

  const family = await request(familyUrl, "/api/v1/families", {
    method: "POST",
    headers: { "x-user-id": userId, "content-type": "application/json", "x-idempotency-key": "family-" + randomUUID() },
    body: JSON.stringify({ name: familyName }),
  });
  assert.equal(family.response.status, 201);
  familyId = family.body?.data?.familyId;
  assert.ok(familyId);
});

after(async () => {
  if (listId) {
    await pool.query("DELETE FROM shopping_domain.items WHERE list_id=$1", [listId]);
    await pool.query("DELETE FROM shopping_domain.outbox_events WHERE aggregate_id=$1 OR family_id=$2", [listId, familyId]);
    await pool.query("DELETE FROM shopping_domain.idempotency_keys WHERE family_id=$1", [familyId]);
    await pool.query("DELETE FROM shopping_domain.lists WHERE id=$1", [listId]);
  }
  if (familyId) {
    const family = await request(familyUrl, "/api/v1/families/" + familyId, { headers: { "x-user-id": userId } });
    if (family.response.status === 200) {
      await request(familyUrl, "/api/v1/families/" + familyId, {
        method: "DELETE",
        headers: {
          "x-user-id": userId,
          "x-idempotency-key": "cleanup-" + randomUUID(),
          "if-match": String(family.body?.data?.version),
        },
      });
    }
  }
  await pool.end();
});

describe("service-shopping / real lifecycle", () => {
  it("creates a list atomically and emits ShoppingListCreated", async () => {
    assert.ok(familyId);
    const created = await request(shoppingUrl, "/api/v1/shopping/lists", {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", "x-idempotency-key": "create-" + randomUUID() },
      body: JSON.stringify({ familyId, name: "Spesa integrazione" }),
    });
    assert.equal(created.response.status, 201);
    listId = created.body?.data?.listId;
    assert.ok(listId);
    assert.equal(Number(created.body?.version), 1);

    const event = await pool.query("SELECT event_type FROM shopping_domain.outbox_events WHERE aggregate_id=$1", [listId]);
    assert.equal(event.rowCount, 1);
    assert.equal(event.rows[0].event_type, "ShoppingListCreated");
  });

  it("replays list creation idempotently", async () => {
    assert.ok(familyId);
    const key = "replay-" + randomUUID();
    const payload = { familyId, name: "Replay List" };
    const first = await request(shoppingUrl, "/api/v1/shopping/lists", {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", "x-idempotency-key": key },
      body: JSON.stringify(payload),
    });
    const second = await request(shoppingUrl, "/api/v1/shopping/lists", {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", "x-idempotency-key": key },
      body: JSON.stringify(payload),
    });
    assert.equal(first.response.status, 201);
    assert.deepEqual(second.body, first.body);
    await pool.query("DELETE FROM shopping_domain.lists WHERE id=$1", [first.body?.data?.listId]);
  });

  it("adds an item and advances the list version", async () => {
    assert.ok(listId);
    const added = await request(shoppingUrl, "/api/v1/shopping/lists/" + listId + "/items", {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", "x-idempotency-key": "add-" + randomUUID() },
      body: JSON.stringify({ productId: randomUUID(), label: "Latte", quantity: 2, unit: "l" }),
    });
    assert.equal(added.response.status, 201);
    itemId = added.body?.data?.itemId;
    itemVersion = Number(added.body?.version);
    assert.equal(itemVersion, 1);
  });

  it("updates the item and rejects stale If-Match", async () => {
    assert.ok(listId && itemId);
    const updated = await request(shoppingUrl, "/api/v1/shopping/lists/" + listId + "/items/" + itemId, {
      method: "PATCH",
      headers: { ...headers(), "content-type": "application/json", "x-idempotency-key": "update-" + randomUUID(), "if-match": String(itemVersion) },
      body: JSON.stringify({ quantity: 3, checked: true }),
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body?.data?.quantity, 3);
    assert.equal(updated.body?.data?.checked, true);
    itemVersion = Number(updated.body?.version);

    const stale = await request(shoppingUrl, "/api/v1/shopping/lists/" + listId + "/items/" + itemId, {
      method: "PATCH",
      headers: { ...headers(), "content-type": "application/json", "x-idempotency-key": "stale-" + randomUUID(), "if-match": "1" },
      body: JSON.stringify({ quantity: 4 }),
    });
    assert.equal(stale.response.status, 412);
    assert.equal(stale.body?.error?.code, "PRECONDITION_FAILED");
  });

  it("reads the list and item through the real endpoint", async () => {
    assert.ok(listId && itemId);
    const list = await request(shoppingUrl, "/api/v1/shopping/lists/" + listId, { headers: headers() });
    assert.equal(list.response.status, 200);
    assert.equal(list.body?.data?.items?.[0]?.itemId, itemId);
    assert.equal(list.body?.data?.items?.[0]?.version, itemVersion);
  });

  it("deletes the item using optimistic locking", async () => {
    assert.ok(listId && itemId);
    const removed = await request(shoppingUrl, "/api/v1/shopping/lists/" + listId + "/items/" + itemId, {
      method: "DELETE",
      headers: { ...headers(), "x-idempotency-key": "delete-" + randomUUID(), "if-match": String(itemVersion) },
    });
    assert.equal(removed.response.status, 204);
    const row = await pool.query("SELECT id FROM shopping_domain.items WHERE id=$1", [itemId]);
    assert.equal(row.rowCount, 0);
    itemId = undefined;
  });

  it("closes the list and rejects subsequent mutations", async () => {
    assert.ok(listId);
    const closed = await request(shoppingUrl, "/api/v1/shopping/lists/" + listId + "/close", {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", "x-idempotency-key": "close-" + randomUUID() },
      body: JSON.stringify({}),
    });
    assert.equal(closed.response.status, 200);
    assert.equal(closed.body?.data?.status, "closed");

    const afterClose = await request(shoppingUrl, "/api/v1/shopping/lists/" + listId + "/items", {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", "x-idempotency-key": "closed-" + randomUUID() },
      body: JSON.stringify({ label: "Non deve entrare", quantity: 1, unit: "piece" }),
    });
    assert.equal(afterClose.response.status, 422);
    assert.equal(afterClose.body?.error?.code, "BUSINESS_RULE_VIOLATION");
  });
});
