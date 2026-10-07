import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";

const inventoryUrl = process.env.INVENTORY_TEST_URL ?? "http://127.0.0.1:3312";
const familyUrl = process.env.INVENTORY_TEST_FAMILY_URL ?? "http://127.0.0.1:3311";
const databaseUrl = process.env.INVENTORY_TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "INVENTORY_TEST_DATABASE_URL is required. " +
    "The integration suite intentionally uses real PostgreSQL and a real service-family instance.",
  );
}

const pool = new Pool({ connectionString: databaseUrl });
const ownerUserId = randomUUID();
const familyName = `inventory-integration-${Date.now()}-${randomUUID().slice(0, 8)}`;
const productId = randomUUID();
let familyId: string | undefined;
let itemId: string | undefined;
let itemVersion = 1;

async function request(base: string, path: string, init?: RequestInit) {
  const response = await fetch(base + path, init);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) as Record<string, any> : undefined };
}

function authHeaders(): Record<string, string> {
  return {
    "x-user-id": ownerUserId,
    "x-family-id": familyId ?? "",
  };
}

describe("service-inventory / real cross-service integration", () => {
  before(async () => {
    const inventoryHealth = await request(inventoryUrl, "/health/ready");
    assert.equal(inventoryHealth.response.status, 200);

    const familyHealth = await request(familyUrl, "/health/ready");
    assert.equal(familyHealth.response.status, 200);

    const created = await request(familyUrl, "/api/v1/families", {
      method: "POST",
      headers: {
        "x-user-id": ownerUserId,
        "content-type": "application/json",
        "x-idempotency-key": `family-${randomUUID()}`,
      },
      body: JSON.stringify({ name: familyName }),
    });
    assert.equal(created.response.status, 201);
    familyId = created.body?.data?.familyId;
    assert.match(familyId ?? "", /^[0-9a-f-]{36}$/i);
  });

  after(async () => {
    if (familyId) {
      await pool.query("DELETE FROM movements WHERE family_id=$1", [familyId]);
      await pool.query("DELETE FROM pantry_items WHERE family_id=$1", [familyId]);
      await pool.query("DELETE FROM pantry_lots WHERE family_id=$1", [familyId]);
      await pool.query("DELETE FROM outbox_events WHERE family_id=$1", [familyId]);
      await pool.query("DELETE FROM idempotency_keys WHERE family_id=$1", [familyId]);

      const family = await request(familyUrl, `/api/v1/families/${familyId}`, {
        headers: { "x-user-id": ownerUserId },
      });
      const version = Number(family.body?.data?.version);
      if (family.response.status === 200 && Number.isInteger(version) && version >= 1) {
        await request(familyUrl, `/api/v1/families/${familyId}`, {
          method: "DELETE",
          headers: {
            "x-user-id": ownerUserId,
            "x-idempotency-key": `cleanup-${randomUUID()}`,
            "if-match": String(version),
          },
        });
      }
    }
    await pool.end();
  });

  it("passes the real Family membership boundary before reading inventory", async () => {
    assert.ok(familyId);
    const members = await request(familyUrl, `/api/v1/families/${familyId}/members`, {
      headers: { "x-user-id": ownerUserId },
    });
    assert.equal(members.response.status, 200);
    assert.equal(members.body?.items?.[0]?.userId, ownerUserId);
    assert.equal(members.body?.items?.[0]?.status, "ACTIVE");
  });

  it("creates inventory through the real Family authorization path and real PostgreSQL", async () => {
    assert.ok(familyId);
    const created = await request(inventoryUrl, "/api/v1/inventory/items", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
        "x-idempotency-key": `item-${randomUUID()}`,
      },
      body: JSON.stringify({
        productId,
        quantity: 3,
        unit: "piece",
        location: "pantry",
        lotCode: "INT-001",
      }),
    });

    assert.equal(created.response.status, 201);
    itemId = created.body?.data?.itemId;
    itemVersion = Number(created.body?.version);
    assert.match(itemId ?? "", /^[0-9a-f-]{36}$/i);
    assert.equal(itemVersion, 1);

    const db = await pool.query(
      "SELECT family_id,product_id,quantity,unit,location,lot_code,version FROM pantry_items WHERE id=$1",
      [itemId],
    );
    assert.equal(db.rowCount, 1);
    assert.equal(db.rows[0].family_id, familyId);
    assert.equal(db.rows[0].product_id, productId);
    assert.equal(Number(db.rows[0].quantity), 3);
    assert.equal(db.rows[0].location, "pantry");
  });

  it("merges separate creates for the same current stock identity", async () => {
    assert.ok(familyId);
    const mergeProductId = randomUUID();
    const first = await request(inventoryUrl, "/api/v1/inventory/items", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "x-idempotency-key": `merge-1-${randomUUID()}` },
      body: JSON.stringify({ productId: mergeProductId, quantity: 2, unit: "piece", location: "pantry" }),
    });
    assert.equal(first.response.status, 201);

    const second = await request(inventoryUrl, "/api/v1/inventory/items", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "x-idempotency-key": `merge-2-${randomUUID()}` },
      body: JSON.stringify({ productId: mergeProductId, quantity: 3, unit: "piece", location: "pantry" }),
    });
    assert.equal(second.response.status, 201);
    assert.equal(second.body?.data?.itemId, first.body?.data?.itemId);
    assert.equal(second.body?.data?.quantity, 5);

    const rows = await pool.query(
      "SELECT count(*)::int AS count, COALESCE(SUM(quantity),0)::numeric AS quantity FROM pantry_items WHERE family_id=$1 AND product_id=$2 AND unit='piece' AND location='pantry' AND lot_id IS NULL AND lot_code IS NULL",
      [familyId, mergeProductId],
    );
    assert.equal(rows.rows[0].count, 1);
    assert.equal(Number(rows.rows[0].quantity), 5);
  });

  it("replays inventory creation idempotently without creating a second row", async () => {
    assert.ok(familyId);
    const key = `idem-${randomUUID()}`;
    const payload = { productId: randomUUID(), quantity: 2, unit: "piece" };

    const first = await request(inventoryUrl, "/api/v1/inventory/items", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "x-idempotency-key": key },
      body: JSON.stringify(payload),
    });
    assert.equal(first.response.status, 201);

    const second = await request(inventoryUrl, "/api/v1/inventory/items", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "x-idempotency-key": key },
      body: JSON.stringify(payload),
    });
    assert.equal(second.response.status, 201);
    assert.deepEqual(second.body, first.body);

    const rows = await pool.query(
      "SELECT count(*)::int AS count FROM pantry_items WHERE family_id=$1 AND product_id=$2",
      [familyId, payload.productId],
    );
    assert.equal(rows.rows[0].count, 1);
  });

  it("rejects stale If-Match before changing inventory", async () => {
    assert.ok(itemId);
    const stale = await request(inventoryUrl, `/api/v1/inventory/${itemId}/consume`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
        "x-idempotency-key": `stale-${randomUUID()}`,
        "if-match": "99",
      },
      body: JSON.stringify({ quantity: 1, reason: "used" }),
    });
    assert.equal(stale.response.status, 412);
    assert.equal(stale.body?.error?.code, "VERSION_CONFLICT");

    const db = await pool.query("SELECT quantity,version FROM pantry_items WHERE id=$1", [itemId]);
    assert.equal(Number(db.rows[0].quantity), 3);
    assert.equal(Number(db.rows[0].version), 1);
  });

  it("consumes partially and records an immutable movement plus outbox event", async () => {
    assert.ok(itemId);
    const result = await request(inventoryUrl, `/api/v1/inventory/${itemId}/consume`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
        "x-idempotency-key": `consume-${randomUUID()}`,
        "if-match": String(itemVersion),
      },
      body: JSON.stringify({ quantity: 1, reason: "used" }),
    });

    assert.equal(result.response.status, 200);
    assert.equal(Number(result.body?.data?.quantity), 2);
    itemVersion = Number(result.body?.version);
    assert.equal(itemVersion, 2);

    const movement = await pool.query(
      "SELECT type,quantity,reason,pantry_item_id FROM movements WHERE pantry_item_id=$1 ORDER BY occurred_at DESC LIMIT 1",
      [itemId],
    );
    assert.equal(movement.rows[0].type, "consume");
    assert.equal(Number(movement.rows[0].quantity), 1);
    assert.equal(movement.rows[0].reason, "used");
    assert.equal(movement.rows[0].pantry_item_id, itemId);

    const event = await pool.query(
      "SELECT event_type FROM outbox_events WHERE aggregate_id=$1 AND event_type='PantryItemAdjusted'",
      [itemId],
    );
    assert.ok(event.rowCount >= 1);
  });

  it("applies PATCH /inventory/{itemId} as required by the API contract", async () => {
    assert.ok(itemId);
    const patched = await request(inventoryUrl, `/api/v1/inventory/${itemId}`, {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
        "x-idempotency-key": `patch-${randomUUID()}`,
        "if-match": String(itemVersion),
      },
      body: JSON.stringify({ location: "fridge" }),
    });

    assert.equal(patched.response.status, 200);
    assert.equal(patched.body?.data?.location, "fridge");
    itemVersion = Number(patched.body?.version);
    assert.equal(itemVersion, 3);
  });

  it("reads the item and its movement history from real PostgreSQL", async () => {
    assert.ok(itemId);
    const item = await request(inventoryUrl, `/api/v1/inventory/${itemId}`, {
      headers: authHeaders(),
    });
    assert.equal(item.response.status, 200);
    assert.equal(item.body?.data?.itemId, itemId);
    assert.equal(item.body?.data?.quantity, 2);
    assert.equal(item.body?.data?.location, "fridge");

    const movements = await request(inventoryUrl, `/api/v1/inventory/${itemId}/movements`, {
      headers: authHeaders(),
    });
    assert.equal(movements.response.status, 200);
    assert.ok(movements.body?.items?.some((entry: any) => entry.type === "consume"));
  });

  it("removes the current item when the last quantity is consumed while retaining history", async () => {
    assert.ok(itemId);
    const result = await request(inventoryUrl, `/api/v1/inventory/${itemId}/waste`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
        "x-idempotency-key": `waste-${randomUUID()}`,
        "if-match": String(itemVersion),
      },
      body: JSON.stringify({ quantity: 2, reason: "spoiled" }),
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.body?.data?.remainingQuantity, 0);
    assert.equal(result.body?.data?.removed, true);

    const current = await pool.query("SELECT id FROM pantry_items WHERE id=$1", [itemId]);
    assert.equal(current.rowCount, 0);

    const history = await pool.query(
      "SELECT type,quantity,pantry_item_id FROM movements WHERE product_id=$1 ORDER BY occurred_at",
      [productId],
    );
    assert.ok(history.rows.some((row) => row.type === "waste" && Number(row.quantity) === 2 && row.pantry_item_id === null));
  });

  it("confirms a declared expiration through the real service", async () => {
    assert.ok(familyId);
    const add = await request(inventoryUrl, "/api/v1/inventory/items", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
        "x-idempotency-key": `expiration-item-${randomUUID()}`,
      },
      body: JSON.stringify({ productId: randomUUID(), quantity: 1, unit: "piece" }),
    });
    assert.equal(add.response.status, 201);
    const id = add.body?.data?.itemId;
    const version = Number(add.body?.version);

    const expiration = await request(inventoryUrl, `/api/v1/inventory/${id}/expiration/confirm`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
        "x-idempotency-key": `expiration-${randomUUID()}`,
        "if-match": String(version),
      },
      body: JSON.stringify({ expiresAt: "2030-01-01T00:00:00Z", source: "declared" }),
    });
    assert.equal(expiration.response.status, 200);
    assert.equal(expiration.body?.data?.expirationSource, "declared");
    assert.notEqual(Number(expiration.body?.version), version);
  });
});
