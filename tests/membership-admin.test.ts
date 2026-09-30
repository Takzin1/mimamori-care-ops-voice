import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryMembershipAdminRepository,
  InvalidMembershipAdminCommandError,
  MembershipAdminConflictError,
  MembershipAdminService,
  createManagedMembership,
  executeMembershipCommand,
  replayMembership,
} from "../src/index.ts";

test("membership admin lifecycle is versioned, reasoned, and replayable", () => {
  const created = createManagedMembership(
    {
      tenantId: "provider-a",
      principalId: "principal-a",
      actorId: "responder-a",
      roles: ["responder"],
      adminActorId: "admin-root",
      reason: "initial staff provisioning",
    },
    "2026-09-26T01:00:00.000Z",
  );

  assert.deepEqual(created.membership, {
    tenantId: "provider-a",
    principalId: "principal-a",
    actorId: "responder-a",
    roles: ["responder"],
    active: true,
    version: 1,
    createdAt: "2026-09-26T01:00:00.000Z",
    updatedAt: "2026-09-26T01:00:00.000Z",
  });

  const rolesChanged = executeMembershipCommand(
    created.membership,
    1,
    {
      type: "replace_roles",
      roles: ["responder", "dispatcher"],
      adminActorId: "admin-root",
      reason: "dispatcher duty added",
    },
    "2026-09-26T01:05:00.000Z",
  );

  assert.equal(
    rolesChanged.event.type,
    "roles_replaced",
  );
  assert.equal(
    rolesChanged.event.adminActorId,
    "admin-root",
  );
  assert.equal(
    rolesChanged.event.reason,
    "dispatcher duty added",
  );
  assert.deepEqual(
    rolesChanged.membership.roles,
    ["dispatcher", "responder"],
  );
  assert.equal(rolesChanged.membership.version, 2);

  const deactivated = executeMembershipCommand(
    rolesChanged.membership,
    2,
    {
      type: "deactivate",
      adminActorId: "admin-root",
      reason: "staff transfer",
    },
    "2026-09-26T01:10:00.000Z",
  );

  assert.equal(deactivated.membership.active, false);
  assert.equal(deactivated.membership.version, 3);
  assert.equal(
    deactivated.event.type,
    "membership_deactivated",
  );

  const activated = executeMembershipCommand(
    deactivated.membership,
    3,
    {
      type: "activate",
      adminActorId: "admin-root",
      reason: "staff returned",
    },
    "2026-09-26T01:15:00.000Z",
  );

  const actorChanged = executeMembershipCommand(
    activated.membership,
    4,
    {
      type: "change_actor_id",
      actorId: "responder-a-renamed",
      adminActorId: "admin-root",
      reason: "operator identifier migration",
    },
    "2026-09-26T01:20:00.000Z",
  );

  const replayed = replayMembership([
    created.event,
    rolesChanged.event,
    deactivated.event,
    activated.event,
    actorChanged.event,
  ]);

  assert.deepEqual(replayed, actorChanged.membership);
  assert.equal(replayed.version, 5);
  assert.equal(replayed.actorId, "responder-a-renamed");
  assert.equal(replayed.active, true);
});

test("membership admin rejects stale and no-op mutations", () => {
  const created = createManagedMembership(
    {
      tenantId: "provider-a",
      principalId: "principal-a",
      actorId: "responder-a",
      roles: ["responder"],
      adminActorId: "admin-root",
      reason: "initial staff provisioning",
    },
    "2026-09-26T01:00:00.000Z",
  );

  assert.throws(
    () =>
      executeMembershipCommand(
        created.membership,
        0,
        {
          type: "deactivate",
          adminActorId: "admin-root",
          reason: "stale attempt",
        },
        "2026-09-26T01:01:00.000Z",
      ),
    MembershipAdminConflictError,
  );

  assert.throws(
    () =>
      executeMembershipCommand(
        created.membership,
        1,
        {
          type: "replace_roles",
          roles: ["responder"],
          adminActorId: "admin-root",
          reason: "no-op",
        },
        "2026-09-26T01:01:00.000Z",
      ),
    InvalidMembershipAdminCommandError,
  );

  assert.throws(
    () =>
      executeMembershipCommand(
        created.membership,
        1,
        {
          type: "replace_roles",
          roles: [],
          adminActorId: "admin-root",
          reason: "invalid empty roles",
        },
        "2026-09-26T01:01:00.000Z",
      ),
    InvalidMembershipAdminCommandError,
  );
});

test("in-memory admin repository allows one winner for the same expected version", async () => {
  const repository =
    new InMemoryMembershipAdminRepository();

  const times = [
    "2026-09-26T01:00:00.000Z",
    "2026-09-26T01:05:00.000Z",
    "2026-09-26T01:06:00.000Z",
  ];
  let cursor = 0;

  const service = new MembershipAdminService(
    repository,
    () => times[cursor++] ??
      "2026-09-26T02:00:00.000Z",
  );

  const created = await service.create({
    tenantId: "provider-a",
    principalId: "principal-a",
    actorId: "responder-a",
    roles: ["responder"],
    adminActorId: "admin-root",
    reason: "initial staff provisioning",
  });

  assert.equal(created.version, 1);

  const first = await service.execute({
    tenantId: "provider-a",
    principalId: "principal-a",
    expectedVersion: 1,
    command: {
      type: "replace_roles",
      roles: ["responder", "dispatcher"],
      adminActorId: "admin-root",
      reason: "dispatcher duty added",
    },
  });

  assert.equal(first.version, 2);

  await assert.rejects(
    service.execute({
      tenantId: "provider-a",
      principalId: "principal-a",
      expectedVersion: 1,
      command: {
        type: "deactivate",
        adminActorId: "admin-root",
        reason: "stale competing mutation",
      },
    }),
    MembershipAdminConflictError,
  );

  const stored = await service.get(
    "provider-a",
    "principal-a",
  );

  assert.equal(stored?.membership.version, 2);
  assert.equal(stored?.events.length, 2);
  assert.deepEqual(
    stored?.events.map((event) => event.type),
    ["membership_created", "roles_replaced"],
  );
});


test("membership admin rejects unsafe actor identifiers", () => {
  assert.throws(
    () =>
      createManagedMembership(
        {
          tenantId: "provider-a",
          principalId: "principal-unsafe",
          actorId:
            "responder-a,or(actor_id.eq.attacker)",
          roles: ["responder"],
          adminActorId: "admin-root",
          reason: "unsafe actor test",
        },
        "2026-09-26T01:00:00.000Z",
      ),
    InvalidMembershipAdminCommandError,
  );

  const created = createManagedMembership(
    {
      tenantId: "provider-a",
      principalId: "principal-safe",
      actorId: "responder-safe",
      roles: ["responder"],
      adminActorId: "admin-root",
      reason: "safe actor",
    },
    "2026-09-26T01:00:00.000Z",
  );

  assert.throws(
    () =>
      executeMembershipCommand(
        created.membership,
        1,
        {
          type: "change_actor_id",
          actorId: "responder unsafe",
          adminActorId: "admin-root",
          reason: "unsafe actor change",
        },
        "2026-09-26T01:05:00.000Z",
      ),
    InvalidMembershipAdminCommandError,
  );
});
