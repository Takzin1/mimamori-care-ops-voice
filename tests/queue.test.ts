import assert from "node:assert/strict";
import test from "node:test";

import {
  CaseAccessDeniedError,
  CaseQueueService,
  InMemoryCaseRepository,
  InMemoryTenantMembershipDirectory,
  InMemoryTenantSlaPolicyDirectory,
  createCase,
  executeCommand,
  projectCaseQueue,
  type CaseCommand,
  type CaseCreatedEvent,
  type CaseSlaPolicy,
  type StoredCase,
} from "../src/index.ts";

const minute = 60_000;

function at(value: number): string {
  return new Date(Date.UTC(2026, 8, 25, 4, value, 0)).toISOString();
}

const policy: CaseSlaPolicy = {
  critical: {
    acknowledgeWithinMs: 2 * minute,
    assignWithinMs: 5 * minute,
    firstActionWithinMs: 5 * minute,
    handoffAcceptWithinMs: 5 * minute,
    completeWithinMs: 30 * minute,
  },
  high: {
    acknowledgeWithinMs: 10 * minute,
    assignWithinMs: 20 * minute,
    firstActionWithinMs: 20 * minute,
    handoffAcceptWithinMs: 10 * minute,
    completeWithinMs: 60 * minute,
  },
  normal: {
    acknowledgeWithinMs: 30 * minute,
    assignWithinMs: 30 * minute,
    firstActionWithinMs: 30 * minute,
    handoffAcceptWithinMs: 10 * minute,
    completeWithinMs: 90 * minute,
  },
  low: {
    acknowledgeWithinMs: 60 * minute,
    assignWithinMs: 60 * minute,
    firstActionWithinMs: 60 * minute,
    handoffAcceptWithinMs: 30 * minute,
    completeWithinMs: 180 * minute,
  },
};

type TimedCommand = {
  minute: number;
  command: CaseCommand;
};

function buildStored(
  caseId: string,
  tenantId: string,
  priority: "critical" | "high" | "normal" | "low",
  commands: readonly TimedCommand[] = [],
): StoredCase {
  let { aggregate, event } = createCase({
    id: caseId,
    tenantId,
    sourceAdapter: "queue-test",
    sourceSignalId: `signal-${caseId}`,
    subjectId: `subject-${caseId}`,
    sourceType: "non_response",
    priority,
    createdAt: at(0),
  });

  const events = [event];

  for (const step of commands) {
    const result = executeCommand(
      aggregate,
      aggregate.version,
      step.command,
      at(step.minute),
    );
    aggregate = result.aggregate;
    events.push(result.event);
  }

  return { aggregate, events };
}

async function persistStored(
  repository: InMemoryCaseRepository,
  stored: StoredCase,
): Promise<void> {
  const first = stored.events[0];
  assert.ok(first && first.type === "case_created");

  await repository.create(first as CaseCreatedEvent);

  for (const event of stored.events.slice(1)) {
    await repository.append({
      tenantId: stored.aggregate.tenantId,
      caseId: stored.aggregate.id,
      expectedVersion: event.sequence - 1,
      event,
    });
  }
}

function fixtures(): StoredCase[] {
  const criticalBreached = buildStored(
    "case-critical-breached",
    "provider-a",
    "critical",
  );

  const highUnassigned = buildStored(
    "case-high-unassigned",
    "provider-a",
    "high",
    [
      {
        minute: 5,
        command: {
          type: "acknowledge",
          actorId: "dispatcher",
        },
      },
    ],
  );

  const handoffPending = buildStored(
    "case-normal-handoff",
    "provider-a",
    "normal",
    [
      {
        minute: 1,
        command: {
          type: "acknowledge",
          actorId: "dispatcher",
        },
      },
      {
        minute: 2,
        command: {
          type: "assign",
          actorId: "dispatcher",
          assigneeId: "responder-a",
        },
      },
      {
        minute: 3,
        command: {
          type: "start_action",
          actorId: "responder-a",
        },
      },
      {
        minute: 14,
        command: {
          type: "request_handoff",
          actorId: "responder-a",
          targetAssigneeId: "responder-b",
        },
      },
    ],
  );

  const completed = buildStored(
    "case-low-completed",
    "provider-a",
    "low",
    [
      {
        minute: 1,
        command: {
          type: "acknowledge",
          actorId: "dispatcher",
        },
      },
      {
        minute: 2,
        command: {
          type: "assign",
          actorId: "dispatcher",
          assigneeId: "responder-a",
        },
      },
      {
        minute: 3,
        command: {
          type: "start_action",
          actorId: "responder-a",
        },
      },
      {
        minute: 4,
        command: {
          type: "complete",
          actorId: "responder-a",
          outcome: "confirmed_safe",
          summary: "synthetic completion",
          evidence: [{ kind: "note", ref: "synthetic:001" }],
        },
      },
    ],
  );

  const otherTenant = buildStored(
    "case-other-tenant",
    "provider-b",
    "critical",
  );

  return [
    highUnassigned,
    completed,
    otherTenant,
    handoffPending,
    criticalBreached,
  ];
}

test("tenant queue is deterministic and explains why Cases surface", () => {
  const projection = projectCaseQueue(
    fixtures(),
    "provider-a",
    { type: "tenant" },
    policy,
    at(15),
  );

  assert.deepEqual(
    projection.items.map((item) => item.caseId),
    [
      "case-critical-breached",
      "case-high-unassigned",
      "case-normal-handoff",
    ],
  );

  assert.deepEqual(
    projection.items.map((item) => item.attentionReason),
    [
      "sla_breach",
      "unassigned",
      "handoff_pending",
    ],
  );

  assert.deepEqual(projection.summary, {
    total: 3,
    breached: 1,
    unacknowledged: 1,
    unassigned: 1,
    handoffPending: 1,
    byPriority: {
      critical: 1,
      high: 1,
      normal: 1,
      low: 0,
    },
  });

  assert.equal(
    projection.items.some(
      (item) => item.tenantId !== "provider-a",
    ),
    false,
  );
  assert.equal(
    projection.items.some(
      (item) => item.status === "COMPLETED",
    ),
    false,
  );
});

test("responder queue includes current ownership and incoming handoff only", () => {
  const projection = projectCaseQueue(
    fixtures(),
    "provider-a",
    { type: "responder", actorId: "responder-b" },
    policy,
    at(15),
  );

  assert.deepEqual(
    projection.items.map((item) => item.caseId),
    ["case-normal-handoff"],
  );
  assert.equal(
    projection.items[0]?.handoffTargetId,
    "responder-b",
  );
});

test("authorized Queue Service scopes responder and tenant-wide views", async () => {
  const repository = new InMemoryCaseRepository();
  for (const stored of fixtures()) {
    await persistStored(repository, stored);
  }

  const memberships = new InMemoryTenantMembershipDirectory([
    {
      tenantId: "provider-a",
      principalId: "principal-dispatcher",
      actorId: "dispatcher",
      roles: ["dispatcher"],
      active: true,
    },
    {
      tenantId: "provider-a",
      principalId: "principal-responder-b",
      actorId: "responder-b",
      roles: ["responder"],
      active: true,
    },
    {
      tenantId: "provider-a",
      principalId: "principal-auditor",
      actorId: "auditor",
      roles: ["auditor"],
      active: true,
    },
  ]);

  const policies = new InMemoryTenantSlaPolicyDirectory({
    "provider-a": policy,
  });

  const service = new CaseQueueService(
    repository,
    memberships,
    policies,
    () => at(15),
  );

  const dispatcher = await service.list({
    tenantId: "provider-a",
    principalId: "principal-dispatcher",
  });
  assert.equal(dispatcher.summary.total, 3);

  const auditor = await service.list({
    tenantId: "provider-a",
    principalId: "principal-auditor",
  });
  assert.equal(auditor.summary.total, 3);

  const responder = await service.list({
    tenantId: "provider-a",
    principalId: "principal-responder-b",
  });
  assert.deepEqual(
    responder.items.map((item) => item.caseId),
    ["case-normal-handoff"],
  );

  await assert.rejects(
    service.list({
      tenantId: "provider-b",
      principalId: "principal-dispatcher",
    }),
    CaseAccessDeniedError,
  );
});
