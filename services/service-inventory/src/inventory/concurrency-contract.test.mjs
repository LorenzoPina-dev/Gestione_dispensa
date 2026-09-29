import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const postgres = fs.readFileSync(new URL("./postgres.ts", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("./service.ts", import.meta.url), "utf8");

test("inventory movement enforces the client version inside the locked transaction", () => {
  assert.match(postgres, /SELECT id, family_id, product_id, current_quantity, unit, reorder_point, version, status[\s\S]*?FOR UPDATE/);
  assert.match(postgres, /row\.version !== input\.expectedVersion/);
  assert.match(postgres, /new InventoryConflictError\(\"Stock item version is stale\."\)/);
  assert.match(service, /expectedVersion: number;/);
  assert.match(service, /expectedVersion must be a positive integer/);
});

test("idempotency lookup precedes the optimistic-version check", () => {
  const duplicate = postgres.indexOf("WHERE m.family_id = $1 AND m.client_operation_id = $2");
  const versionCheck = postgres.indexOf("row.version !== input.expectedVersion");
  assert.notEqual(duplicate, -1);
  assert.ok(duplicate < versionCheck);
});
