import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("SKIP: DATABASE_URL is not set; run this test against the production-like PostgreSQL instance.");
  process.exit(0);
}

const { Client } = await import("pg");
const client = new Client({ connectionString: databaseUrl });
await client.connect();

const userA = randomUUID();
const userB = randomUUID();
const familyA = randomUUID();
const familyB = randomUUID();
const notificationA = randomUUID();
const notificationB = randomUUID();

try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.service','true',true)");
  await client.query("INSERT INTO users(id) VALUES ($1),($2)", [userA, userB]);
  await client.query(
    "INSERT INTO families(id,display_name,creator_user_id,locale,timezone,unit_system) VALUES ($1,'RLS A',$2,'it-IT','Europe/Rome','METRIC'),($3,'RLS B',$4,'it-IT','Europe/Rome','METRIC')",
    [familyA, userA, familyB, userB],
  );
  await client.query(
    "INSERT INTO family_memberships(id,family_id,user_id,role,status,joined_at) VALUES ($1,$2,$3,'OWNER','ACTIVE',now()),($4,$5,$6,'OWNER','ACTIVE',now())",
    [randomUUID(), familyA, userA, randomUUID(), familyB, userB],
  );
  await client.query(
    "INSERT INTO notifications(id,family_id,category,title,body) VALUES ($1,$2,'SYSTEM','A','A'),($3,$4,'SYSTEM','B','B')",
    [notificationA, familyA, notificationB, familyB],
  );
  await client.query("COMMIT");

  await client.query("SELECT set_config('app.service','false',false), set_config('app.user_id',$1,false)", [userA]);
  const visible = await client.query("SELECT id FROM notifications ORDER BY id");
  assert.deepEqual(visible.rows.map((r) => r.id), [notificationA], "user A must only see family A");

  await assert.rejects(
    client.query("INSERT INTO notifications(id,family_id,category,title,body) VALUES ($1,$2,'SYSTEM','X','X')", [randomUUID(), familyB]),
    /row-level security|violates row-level security/i,
    "user A must not write family B data",
  );

  await client.query("SELECT set_config('app.service','true',false)");
  await client.query("DELETE FROM notifications WHERE id IN ($1,$2)", [notificationA, notificationB]);
  await client.query("DELETE FROM family_memberships WHERE family_id IN ($1,$2)", [familyA, familyB]);
  await client.query("DELETE FROM families WHERE id IN ($1,$2)", [familyA, familyB]);
  await client.query("DELETE FROM users WHERE id IN ($1,$2)", [userA, userB]);
  console.log("PASS: PostgreSQL RLS prevents cross-family read/write access.");
} finally {
  await client.end();
}
