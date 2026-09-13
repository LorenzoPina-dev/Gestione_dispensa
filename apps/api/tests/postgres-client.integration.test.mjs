// Opt-in PostgreSQL integration test. Unlike every other *-postgres.test.mjs
// in this directory (which exercise PostgresFamilyRepository /
// PostgresInviteRepository against a FakeDatabase/FakeTransaction pair),
// this file runs the SAME repository code against a *real* PostgreSQL
// instance via the PostgresClient adapter. It is the evidence for
// DAT-RUN-001 / DAT-RUN-002's "live execution" boundary, previously waived
// because no Docker engine was available in this environment.
//
// Skips (does not fail) when DATABASE_URL is not set, so `npm test` stays
// green on machines without a database. Run explicitly with:
//   DATABASE_URL=postgresql://user:pass@host:5432/db npm run test:integration
// after applying infra/postgres/migrations 0001-0007 with
// infra/postgres/scripts/migrate.mjs.
//
// The docker-compose based path (`docker compose --profile family-local up`)
// wires DATABASE_URL automatically; see infra/postgres/README.md.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { PostgresClient } from "../src/db/postgres-client.ts";
import { FamilyService } from "../src/family/service.ts";
import { PostgresFamilyRepository, PostgresInviteRepository } from "../src/family/postgres.ts";
import { InviteService } from "../src/family/invites.ts";

const databaseUrl = process.env.DATABASE_URL;
const describeOrSkip = databaseUrl ? test : test.skip;

describeOrSkip(
  "family + invite flow persists correctly against a live PostgreSQL instance",
  async (t) => {
    const db = PostgresClient.create({ connectionString: databaseUrl });
    t.after(() => db.close());

    assert.equal(await db.ping(), true, "Postgres must be reachable for this test to be meaningful");

    const creatorId = randomUUID();
    await db.query("INSERT INTO users (id) VALUES ($1)", [creatorId]);

    const ids = { next: () => randomUUID() };
    const clock = { now: () => new Date() };

    const families = new FamilyService(new PostgresFamilyRepository(db), ids, clock);
    const created = await families.createFamily({
      displayName: "Integration Test Family",
      locale: "it-IT",
      timezone: "Europe/Rome",
      unitSystem: "METRIC",
      creatorUserId: creatorId,
      traceId: randomUUID().replaceAll("-", ""),
    });

    const familyRow = await db.query(
      "SELECT display_name FROM families WHERE id = $1",
      [created.family.id],
    );
    assert.equal(familyRow.rows[0]?.display_name, "Integration Test Family");

    const invites = new InviteService(new PostgresInviteRepository(db), ids, clock);
    const invite = await invites.createInvite({
      familyId: created.family.id,
      actorId: creatorId,
      role: "MEMBER",
      expiresInSeconds: 3600,
    });

    const browserBindingHash = createHash("sha256").update("integration-test-fingerprint").digest("hex");
    const attempt = await invites.resolve(
      invite.qrPayload,
      browserBindingHash,
      randomUUID().replaceAll("-", ""),
    );
    assert.equal(attempt.state, "PENDING_AUTHENTICATION");

    const joinerId = randomUUID();
    await db.query("INSERT INTO users (id) VALUES ($1)", [joinerId]);
    await db.query(
      `INSERT INTO family_memberships (family_id, user_id, role, status)
       VALUES ($1, $2, 'MEMBER', 'PENDING')`,
      [created.family.id, joinerId],
    );

    const accepted = await invites.accept(attempt.id, joinerId, "consent-v1");
    assert.equal(accepted.state, "ACCEPTED");

    const membershipRow = await db.query(
      "SELECT status FROM family_memberships WHERE family_id = $1 AND user_id = $2",
      [created.family.id, joinerId],
    );
    assert.equal(membershipRow.rows[0]?.status, "ACTIVE");

    const inviteRow = await db.query(
      "SELECT status FROM family_invites WHERE id = $1",
      [invite.inviteId],
    );
    assert.equal(inviteRow.rows[0]?.status, "CONSUMED");
  },
);

describeOrSkip(
  "createFamilyAtomic rolls back all writes when any statement in the transaction fails",
  async (t) => {
    const db = PostgresClient.create({ connectionString: databaseUrl });
    t.after(() => db.close());

    const creatorId = randomUUID();
    await db.query("INSERT INTO users (id) VALUES ($1)", [creatorId]);

    // Pre-seed a membership row whose id we will force the service to reuse,
    // so the repository's second INSERT inside the atomic transaction hits a
    // primary key collision and the whole transaction must roll back.
    const collidingMembershipId = randomUUID();
    const otherFamilyId = randomUUID();
    await db.query(
      `INSERT INTO families (id, display_name, creator_user_id, locale, timezone, unit_system, status, version)
       VALUES ($1, 'Other', $2, 'it-IT', 'Europe/Rome', 'METRIC', 'ACTIVE', 1)`,
      [otherFamilyId, creatorId],
    );
    await db.query(
      `INSERT INTO family_memberships (id, family_id, user_id, role, status)
       VALUES ($1, $2, $3, 'OWNER', 'ACTIVE')`,
      [collidingMembershipId, otherFamilyId, creatorId],
    );

    let call = 0;
    const ids = {
      next: () => {
        call += 1;
        // FamilyService.createFamily calls ids.next() for familyId (1st),
        // membershipId (2nd), eventId (3rd). Force the 2nd call to collide.
        return call === 2 ? collidingMembershipId : randomUUID();
      },
    };
    const clock = { now: () => new Date() };
    const families = new FamilyService(new PostgresFamilyRepository(db), ids, clock);

    await assert.rejects(
      families.createFamily({
        displayName: "Should Roll Back",
        locale: "it-IT",
        timezone: "Europe/Rome",
        unitSystem: "METRIC",
        creatorUserId: creatorId,
        traceId: randomUUID().replaceAll("-", ""),
      }),
      /duplicate key value/,
    );

    const orphan = await db.query(
      "SELECT count(*)::text AS count FROM families WHERE display_name = 'Should Roll Back'",
    );
    assert.equal(
      orphan.rows[0]?.count,
      "0",
      "a failed atomic transaction must not leave an orphaned families row",
    );
  },
);
