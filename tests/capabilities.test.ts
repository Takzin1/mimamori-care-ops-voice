import assert from "node:assert/strict";
import test from "node:test";

import {
  createCase,
  executeCommand,
  projectCaseCapabilities,
  projectOperatorContext,
  type CaseAggregate,
  type TenantMembership,
} from "../src/index.ts";

function membership(
  actorId: string,
  roles: TenantMembership["roles"],
): TenantMembership {
  return {
    tenantId: "provider-a",
    principalId: "principal-" + actorId,
    actorId,
    roles,
    active: true,
  };
}

function commandTypes(
  aggregate: CaseAggregate,
  member: TenantMembership,
): string[] {
  return projectCaseCapabilities(
    aggregate,
    member,
  ).commands.map((item) => item.type);
}

function createdCase(): {
  aggregate: CaseAggregate;
  events: unknown[];
} {
  const created = createCase({
    id: "case-cap",
    tenantId: "provider-a",
    sourceAdapter: "test",
    sourceSignalId: "signal-cap",
    subjectId: "subject-cap",
    sourceType: "non_response",
    priority: "high",
    createdAt: "2026-09-26T03:00:00.000Z",
  });

  return {
    aggregate: created.aggregate,
    events: [created.event],
  };
}

test("operator projection exposes safe operational identity and shared Queue visibility", () => {
  assert.deepEqual(
    projectOperatorContext(
      membership(
        "dispatcher-a",
        ["dispatcher"],
      ),
    ),
    {
      tenantId: "provider-a",
      actorId: "dispatcher-a",
      roles: ["dispatcher"],
      queueVisibility: "tenant",
    },
  );

  assert.equal(
    projectOperatorContext(
      membership(
        "responder-a",
        ["responder"],
      ),
    ).queueVisibility,
    "responder",
  );
});

test("NEW Case capabilities combine lifecycle and RBAC", () => {
  const { aggregate } = createdCase();

  assert.deepEqual(
    commandTypes(
      aggregate,
      membership(
        "dispatcher-a",
        ["dispatcher"],
      ),
    ),
    ["set_priority", "acknowledge"],
  );

  assert.deepEqual(
    commandTypes(
      aggregate,
      membership(
        "responder-a",
        ["responder"],
      ),
    ),
    [],
  );

  assert.deepEqual(
    commandTypes(
      aggregate,
      membership(
        "auditor-a",
        ["auditor"],
      ),
    ),
    [],
  );
});

test("ownership-sensitive capabilities follow the same Case Core preconditions", () => {
  let { aggregate } = createdCase();

  aggregate = executeCommand(
    aggregate,
    aggregate.version,
    {
      type: "acknowledge",
      actorId: "dispatcher-a",
    },
    "2026-09-26T03:01:00.000Z",
  ).aggregate;

  assert.deepEqual(
    commandTypes(
      aggregate,
      membership(
        "dispatcher-a",
        ["dispatcher"],
      ),
    ),
    ["set_priority", "assign"],
  );

  aggregate = executeCommand(
    aggregate,
    aggregate.version,
    {
      type: "assign",
      actorId: "dispatcher-a",
      assigneeId: "responder-a",
    },
    "2026-09-26T03:02:00.000Z",
  ).aggregate;

  assert.deepEqual(
    commandTypes(
      aggregate,
      membership(
        "responder-a",
        ["responder"],
      ),
    ),
    ["start_action"],
  );

  assert.deepEqual(
    commandTypes(
      aggregate,
      membership(
        "responder-b",
        ["responder"],
      ),
    ),
    [],
  );

  aggregate = executeCommand(
    aggregate,
    aggregate.version,
    {
      type: "start_action",
      actorId: "responder-a",
    },
    "2026-09-26T03:03:00.000Z",
  ).aggregate;

  assert.deepEqual(
    commandTypes(
      aggregate,
      membership(
        "responder-a",
        ["responder"],
      ),
    ),
    ["request_handoff", "complete"],
  );

  aggregate = executeCommand(
    aggregate,
    aggregate.version,
    {
      type: "request_handoff",
      actorId: "responder-a",
      targetAssigneeId: "responder-b",
    },
    "2026-09-26T03:04:00.000Z",
  ).aggregate;

  assert.deepEqual(
    commandTypes(
      aggregate,
      membership(
        "responder-a",
        ["responder"],
      ),
    ),
    [],
  );

  assert.deepEqual(
    commandTypes(
      aggregate,
      membership(
        "responder-b",
        ["responder"],
      ),
    ),
    ["accept_handoff"],
  );
});

test("capability projection describes required user input without validating target values early", () => {
  const { aggregate } = createdCase();
  const projection =
    projectCaseCapabilities(
      aggregate,
      membership(
        "supervisor-a",
        ["supervisor"],
      ),
    );

  const priority =
    projection.commands.find(
      (item) =>
        item.type === "set_priority",
    );

  assert.deepEqual(
    priority?.requires,
    ["priority"],
  );

  const acknowledge =
    projection.commands.find(
      (item) =>
        item.type === "acknowledge",
    );

  assert.deepEqual(
    acknowledge?.requires,
    [],
  );
});

test("COMPLETED supervisor sees close and reopen while auditor remains read-only", () => {
  let { aggregate } = createdCase();

  aggregate = executeCommand(
    aggregate,
    1,
    {
      type: "acknowledge",
      actorId: "supervisor-a",
    },
    "2026-09-26T03:01:00.000Z",
  ).aggregate;

  aggregate = executeCommand(
    aggregate,
    2,
    {
      type: "assign",
      actorId: "supervisor-a",
      assigneeId: "supervisor-a",
    },
    "2026-09-26T03:02:00.000Z",
  ).aggregate;

  aggregate = executeCommand(
    aggregate,
    3,
    {
      type: "start_action",
      actorId: "supervisor-a",
    },
    "2026-09-26T03:03:00.000Z",
  ).aggregate;

  aggregate = executeCommand(
    aggregate,
    4,
    {
      type: "complete",
      actorId: "supervisor-a",
      outcome: "confirmed_safe",
      summary: "Synthetic completion",
      evidence: [
        {
          kind: "note",
          ref: "synthetic:evidence",
        },
      ],
    },
    "2026-09-26T03:04:00.000Z",
  ).aggregate;

  assert.deepEqual(
    commandTypes(
      aggregate,
      membership(
        "supervisor-a",
        ["supervisor"],
      ),
    ),
    ["close", "reopen"],
  );

  assert.deepEqual(
    commandTypes(
      aggregate,
      membership(
        "auditor-a",
        ["auditor"],
      ),
    ),
    [],
  );
});
