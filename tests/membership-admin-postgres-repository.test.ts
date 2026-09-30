import assert from "node:assert/strict";
import test from "node:test";

import {
  MembershipAdminConflictError,
  PostgresMembershipAdminRepository,
  type AdminSqlExecutor,
  type AdminSqlQueryResult,
} from "../src/index.ts";

class QueueSql implements AdminSqlExecutor {
  readonly calls: Array<{
    sql: string;
    params: readonly unknown[];
  }> = [];
  private readonly results: AdminSqlQueryResult[];

  constructor(
    results: AdminSqlQueryResult[],
  ) {
    this.results = results;
  }

  async query(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<AdminSqlQueryResult> {
    this.calls.push({ sql, params });
    const result = this.results.shift();
    if (!result) {
      throw new Error("unexpected SQL query");
    }
    return result;
  }
}

const snapshot = {
  tenant_id: "provider-a",
  principal_id: "principal-a",
  actor_id: "responder-a",
  roles: ["dispatcher", "responder"],
  active: true,
  version: 2,
  created_at: "2026-09-26T01:00:00.000Z",
  updated_at: "2026-09-26T01:05:00.000Z",
};

test("Postgres membership admin repository loads snapshot and ordered audit stream", async () => {
  const sql = new QueueSql([
    { rows: [snapshot] },
    {
      rows: [
        {
          tenant_id: "provider-a",
          principal_id: "principal-a",
          version: 1,
          event_type: "membership_created",
          admin_actor_id: "admin-root",
          reason: "initial staff provisioning",
          event_at: "2026-09-26T01:00:00.000Z",
          data: {
            actorId: "responder-a",
            roles: ["responder"],
            active: true,
          },
        },
        {
          tenant_id: "provider-a",
          principal_id: "principal-a",
          version: 2,
          event_type: "roles_replaced",
          admin_actor_id: "admin-root",
          reason: "dispatcher duty added",
          event_at: "2026-09-26T01:05:00.000Z",
          data: {
            previousRoles: ["responder"],
            roles: ["dispatcher", "responder"],
          },
        },
      ],
    },
  ]);

  const repository =
    new PostgresMembershipAdminRepository(sql);

  const stored = await repository.load(
    "provider-a",
    "principal-a",
  );

  assert.deepEqual(stored?.membership, {
    tenantId: "provider-a",
    principalId: "principal-a",
    actorId: "responder-a",
    roles: ["dispatcher", "responder"],
    active: true,
    version: 2,
    createdAt: "2026-09-26T01:00:00.000Z",
    updatedAt: "2026-09-26T01:05:00.000Z",
  });

  assert.deepEqual(
    stored?.events.map((event) => event.type),
    ["membership_created", "roles_replaced"],
  );
  assert.equal(sql.calls.length, 2);
  assert.deepEqual(
    sql.calls[0]?.params,
    ["provider-a", "principal-a"],
  );
});

test("Postgres membership admin repository calls private admin functions and maps conflicts", async () => {
  const createSql = new QueueSql([
    {
      rows: [
        {
          result: {
            ok: true,
            membership: {
              tenant_id: "provider-a",
              principal_id: "principal-a",
              actor_id: "responder-a",
              roles: ["responder"],
              active: true,
              version: 1,
              created_at: "2026-09-26T01:00:00.000Z",
              updated_at: "2026-09-26T01:00:00.000Z",
            },
          },
        },
      ],
    },
  ]);

  const repository =
    new PostgresMembershipAdminRepository(createSql);

  const created = await repository.create({
    type: "membership_created",
    tenantId: "provider-a",
    principalId: "principal-a",
    version: 1,
    at: "2026-09-26T01:00:00.000Z",
    adminActorId: "admin-root",
    reason: "initial staff provisioning",
    data: {
      actorId: "responder-a",
      roles: ["responder"],
      active: true,
    },
  });

  assert.equal(created.version, 1);
  assert.ok(
    createSql.calls[0]?.sql.includes(
      "care_admin.create_membership",
    ),
  );

  const conflictSql = new QueueSql([
    {
      rows: [
        {
          result: {
            ok: false,
            conflict: true,
            currentVersion: 3,
          },
        },
      ],
    },
  ]);

  const conflictingRepository =
    new PostgresMembershipAdminRepository(
      conflictSql,
    );

  await assert.rejects(
    conflictingRepository.append({
      tenantId: "provider-a",
      principalId: "principal-a",
      expectedVersion: 2,
      event: {
        type: "membership_deactivated",
        tenantId: "provider-a",
        principalId: "principal-a",
        version: 3,
        at: "2026-09-26T01:10:00.000Z",
        adminActorId: "admin-root",
        reason: "staff transfer",
        data: {},
      },
    }),
    (error: unknown) =>
      error instanceof MembershipAdminConflictError &&
      error.expectedVersion === 2 &&
      error.actualVersion === 3,
  );

  assert.ok(
    conflictSql.calls[0]?.sql.includes(
      "care_admin.transition_membership",
    ),
  );
});
