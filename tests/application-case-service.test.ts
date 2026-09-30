import assert from "node:assert/strict";
import test from "node:test";

import {
  CaseAccessDeniedError,
  CaseService,
  InMemoryCaseRepository,
  InMemoryTenantMembershipDirectory,
} from "../src/index.ts";

function at(minute: number): string {
  return new Date(Date.UTC(2026, 8, 25, 2, minute, 0)).toISOString();
}

function memberships() {
  return new InMemoryTenantMembershipDirectory([
    {
      tenantId: "provider-a",
      principalId: "principal-dispatcher",
      actorId: "dispatcher",
      roles: ["dispatcher"],
      active: true,
    },
    {
      tenantId: "provider-a",
      principalId: "principal-responder-a",
      actorId: "responder-a",
      roles: ["responder"],
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
      principalId: "principal-supervisor",
      actorId: "supervisor",
      roles: ["supervisor"],
      active: true,
    },
    {
      tenantId: "provider-a",
      principalId: "principal-auditor",
      actorId: "auditor",
      roles: ["auditor"],
      active: true,
    },
    {
      tenantId: "provider-a",
      principalId: "principal-inactive",
      actorId: "inactive-responder",
      roles: ["responder"],
      active: false,
    },
  ]);
}

test("application service drives the full authorized GK lifecycle", async () => {
  const times = [
    at(0),
    at(2),
    at(4),
    at(5),
    at(8),
    at(10),
    at(20),
    at(22),
  ];
  let tick = 0;

  const service = new CaseService(
    new InMemoryCaseRepository(),
    memberships(),
    () => times[tick++] ?? at(99),
  );

  let result = await service.openFromSignal(
    {
      id: "signal-001",
      tenantId: "provider-a",
      sourceAdapter: "test-adapter",
      priority: "normal",
      subjectId: "subject-001",
      type: "non_response",
    },
    "case-001",
  );

  assert.equal(result.aggregate.status, "NEW");
  assert.equal(result.aggregate.version, 1);
  assert.equal(result.created, true);

  result = await service.execute({
    tenantId: "provider-a",
    caseId: "case-001",
    principalId: "principal-dispatcher",
    expectedVersion: 1,
    command: { type: "acknowledge" },
  });
  assert.equal(result.event.actorId, "dispatcher");

  result = await service.execute({
    tenantId: "provider-a",
    caseId: "case-001",
    principalId: "principal-dispatcher",
    expectedVersion: 2,
    command: {
      type: "assign",
      assigneeId: "responder-a",
    },
  });

  result = await service.execute({
    tenantId: "provider-a",
    caseId: "case-001",
    principalId: "principal-responder-a",
    expectedVersion: 3,
    command: { type: "start_action" },
  });

  result = await service.execute({
    tenantId: "provider-a",
    caseId: "case-001",
    principalId: "principal-responder-a",
    expectedVersion: 4,
    command: {
      type: "request_handoff",
      targetAssigneeId: "responder-b",
    },
  });

  assert.equal(result.aggregate.status, "HANDOFF_PENDING");
  assert.equal(result.aggregate.assigneeId, "responder-a");
  assert.equal(result.aggregate.handoffTargetId, "responder-b");

  result = await service.execute({
    tenantId: "provider-a",
    caseId: "case-001",
    principalId: "principal-responder-b",
    expectedVersion: 5,
    command: { type: "accept_handoff" },
  });

  result = await service.execute({
    tenantId: "provider-a",
    caseId: "case-001",
    principalId: "principal-responder-b",
    expectedVersion: 6,
    command: {
      type: "complete",
      outcome: "confirmed_safe",
      summary: "電話で本人の安全を確認",
      evidence: [{ kind: "call", ref: "call:001" }],
    },
  });

  assert.equal(result.aggregate.status, "COMPLETED");
  assert.equal(result.aggregate.completion?.completedBy, "responder-b");

  result = await service.execute({
    tenantId: "provider-a",
    caseId: "case-001",
    principalId: "principal-supervisor",
    expectedVersion: 7,
    command: { type: "close" },
  });

  assert.equal(result.aggregate.status, "CLOSED");

  const metrics = await service.metrics({
    tenantId: "provider-a",
    caseId: "case-001",
    principalId: "principal-dispatcher",
  });
  assert.equal(metrics.timeToAcknowledgeMs, 2 * 60_000);
  assert.equal(metrics.timeToAssignmentMs, 4 * 60_000);
  assert.equal(metrics.timeToFirstActionMs, 5 * 60_000);
  assert.equal(metrics.timeToCompletionMs, 20 * 60_000);
  assert.equal(metrics.handoffCount, 1);

  await assert.rejects(
    service.get({
      tenantId: "provider-b",
      caseId: "case-001",
      principalId: "principal-dispatcher",
    }),
    CaseAccessDeniedError,
  );
});

test("caller cannot spoof actorId because application commands do not accept it", async () => {
  const service = new CaseService(
    new InMemoryCaseRepository(),
    memberships(),
    () => at(0),
  );

  await service.openFromSignal(
    {
      id: "signal-spoof",
      tenantId: "provider-a",
      sourceAdapter: "test-adapter",
      priority: "normal",
      subjectId: "subject-spoof",
      type: "manual",
    },
    "case-spoof",
  );

  const result = await service.execute({
    tenantId: "provider-a",
    caseId: "case-spoof",
    principalId: "principal-dispatcher",
    expectedVersion: 1,
    command: { type: "acknowledge" },
  });

  assert.equal(result.event.actorId, "dispatcher");
});

test("auditor is read-only and denial occurs before mutation", async () => {
  const service = new CaseService(
    new InMemoryCaseRepository(),
    memberships(),
    () => at(0),
  );

  await service.openFromSignal(
    {
      id: "signal-audit",
      tenantId: "provider-a",
      sourceAdapter: "test-adapter",
      priority: "normal",
      subjectId: "subject-audit",
      type: "manual",
    },
    "case-audit",
  );

  await assert.rejects(
    service.execute({
      tenantId: "provider-a",
      caseId: "case-audit",
      principalId: "principal-auditor",
      expectedVersion: 1,
      command: { type: "acknowledge" },
    }),
    (error: unknown) =>
      error instanceof CaseAccessDeniedError &&
      error.reason === "command_forbidden",
  );

  const stored = await service.get({
    tenantId: "provider-a",
    caseId: "case-audit",
    principalId: "principal-auditor",
  });
  assert.equal(stored?.aggregate.version, 1);
  assert.equal(stored?.aggregate.status, "NEW");
});

test("dispatcher cannot assign to missing, inactive, or non-responder staff", async () => {
  const service = new CaseService(
    new InMemoryCaseRepository(),
    memberships(),
    () => at(0),
  );

  await service.openFromSignal(
    {
      id: "signal-target",
      tenantId: "provider-a",
      sourceAdapter: "test-adapter",
      priority: "normal",
      subjectId: "subject-target",
      type: "manual",
    },
    "case-target",
  );

  await service.execute({
    tenantId: "provider-a",
    caseId: "case-target",
    principalId: "principal-dispatcher",
    expectedVersion: 1,
    command: { type: "acknowledge" },
  });

  for (const assigneeId of [
    "missing",
    "inactive-responder",
    "auditor",
  ]) {
    await assert.rejects(
      service.execute({
        tenantId: "provider-a",
        caseId: "case-target",
        principalId: "principal-dispatcher",
        expectedVersion: 2,
        command: { type: "assign", assigneeId },
      }),
      CaseAccessDeniedError,
    );
  }

  const stored = await service.get({
    tenantId: "provider-a",
    caseId: "case-target",
    principalId: "principal-dispatcher",
  });
  assert.equal(stored?.aggregate.version, 2);
  assert.equal(stored?.aggregate.status, "ACKNOWLEDGED");
});

test("inactive membership cannot read or mutate Cases", async () => {
  const service = new CaseService(
    new InMemoryCaseRepository(),
    memberships(),
    () => at(0),
  );

  await service.openFromSignal(
    {
      id: "signal-inactive",
      tenantId: "provider-a",
      sourceAdapter: "test-adapter",
      priority: "normal",
      subjectId: "subject-inactive",
      type: "manual",
    },
    "case-inactive",
  );

  await assert.rejects(
    service.get({
      tenantId: "provider-a",
      caseId: "case-inactive",
      principalId: "principal-inactive",
    }),
    (error: unknown) =>
      error instanceof CaseAccessDeniedError &&
      error.reason === "membership_inactive",
  );

  await assert.rejects(
    service.execute({
      tenantId: "provider-a",
      caseId: "case-inactive",
      principalId: "principal-inactive",
      expectedVersion: 1,
      command: { type: "acknowledge" },
    }),
    CaseAccessDeniedError,
  );
});


test("application Signal retry returns the original Case without duplication", async () => {
  const service = new CaseService(
    new InMemoryCaseRepository(),
    memberships(),
    () => at(0),
  );

  const signal = {
    id: "signal-application-retry",
    tenantId: "provider-a",
    sourceAdapter: "line-checkin",
    priority: "normal",
      subjectId: "subject-retry",
    type: "non_response" as const,
  };

  const first = await service.openFromSignal(signal, "case-original");
  const retry = await service.openFromSignal(signal, "case-retry-proposal");

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.aggregate.id, "case-original");
  assert.equal(retry.event.data.caseId, "case-original");

  const original = await service.get({
    tenantId: "provider-a",
    caseId: "case-original",
    principalId: "principal-dispatcher",
  });
  const duplicate = await service.get({
    tenantId: "provider-a",
    caseId: "case-retry-proposal",
    principalId: "principal-dispatcher",
  });

  assert.ok(original);
  assert.equal(duplicate, null);
});


test("priority changes are authorized and audited", async () => {
  const service = new CaseService(
    new InMemoryCaseRepository(),
    memberships(),
    () => at(1),
  );

  await service.openFromSignal(
    {
      id: "signal-priority",
      tenantId: "provider-a",
      sourceAdapter: "test-adapter",
      priority: "normal",
      subjectId: "subject-priority",
      type: "non_response",
    },
    "case-priority",
  );

  await assert.rejects(
    service.execute({
      tenantId: "provider-a",
      caseId: "case-priority",
      principalId: "principal-responder-a",
      expectedVersion: 1,
      command: {
        type: "set_priority",
        priority: "critical",
      },
    }),
    CaseAccessDeniedError,
  );

  const changed = await service.execute({
    tenantId: "provider-a",
    caseId: "case-priority",
    principalId: "principal-dispatcher",
    expectedVersion: 1,
    command: {
      type: "set_priority",
      priority: "critical",
    },
  });

  assert.equal(changed.aggregate.priority, "critical");
  assert.equal(changed.event.type, "priority_changed");
  assert.equal(changed.event.actorId, "dispatcher");
  if (changed.event.type === "priority_changed") {
    assert.equal(changed.event.data.previousPriority, "normal");
    assert.equal(changed.event.data.priority, "critical");
  }
});


test("responder cannot read or mutate a Case outside current ownership/handoff scope", async () => {
  const service = new CaseService(
    new InMemoryCaseRepository(),
    memberships(),
    () => at(0),
  );

  await service.openFromSignal(
    {
      id: "signal-hidden",
      tenantId: "provider-a",
      sourceAdapter: "test-adapter",
      priority: "normal",
      subjectId: "subject-hidden",
      type: "non_response",
    },
    "case-hidden",
  );

  await assert.rejects(
    service.get({
      tenantId: "provider-a",
      caseId: "case-hidden",
      principalId: "principal-responder-a",
    }),
    (error: unknown) =>
      error instanceof CaseAccessDeniedError &&
      error.reason === "case_not_visible",
  );

  await assert.rejects(
    service.metrics({
      tenantId: "provider-a",
      caseId: "case-hidden",
      principalId: "principal-responder-a",
    }),
    (error: unknown) =>
      error instanceof CaseAccessDeniedError &&
      error.reason === "case_not_visible",
  );

  await assert.rejects(
    service.capabilities({
      tenantId: "provider-a",
      caseId: "case-hidden",
      principalId: "principal-responder-a",
    }),
    (error: unknown) =>
      error instanceof CaseAccessDeniedError &&
      error.reason === "case_not_visible",
  );

  await assert.rejects(
    service.execute({
      tenantId: "provider-a",
      caseId: "case-hidden",
      principalId: "principal-responder-a",
      expectedVersion: 1,
      command: { type: "acknowledge" },
    }),
    CaseAccessDeniedError,
  );

  const stored = await service.get({
    tenantId: "provider-a",
    caseId: "case-hidden",
    principalId: "principal-dispatcher",
  });

  assert.equal(stored?.aggregate.status, "NEW");
  assert.equal(stored?.aggregate.version, 1);
});

test("responder Case reads follow current assignment and incoming handoff scope", async () => {
  const service = new CaseService(
    new InMemoryCaseRepository(),
    memberships(),
    () => at(0),
  );

  await service.openFromSignal(
    {
      id: "signal-visible",
      tenantId: "provider-a",
      sourceAdapter: "test-adapter",
      priority: "normal",
      subjectId: "subject-visible",
      type: "manual",
    },
    "case-visible",
  );

  await service.execute({
    tenantId: "provider-a",
    caseId: "case-visible",
    principalId: "principal-dispatcher",
    expectedVersion: 1,
    command: { type: "acknowledge" },
  });

  await service.execute({
    tenantId: "provider-a",
    caseId: "case-visible",
    principalId: "principal-dispatcher",
    expectedVersion: 2,
    command: {
      type: "assign",
      assigneeId: "responder-a",
    },
  });

  const assigned = await service.get({
    tenantId: "provider-a",
    caseId: "case-visible",
    principalId: "principal-responder-a",
  });
  assert.equal(
    assigned?.aggregate.assigneeId,
    "responder-a",
  );

  await assert.rejects(
    service.get({
      tenantId: "provider-a",
      caseId: "case-visible",
      principalId: "principal-responder-b",
    }),
    CaseAccessDeniedError,
  );

  await service.execute({
    tenantId: "provider-a",
    caseId: "case-visible",
    principalId: "principal-responder-a",
    expectedVersion: 3,
    command: { type: "start_action" },
  });

  await service.execute({
    tenantId: "provider-a",
    caseId: "case-visible",
    principalId: "principal-responder-a",
    expectedVersion: 4,
    command: {
      type: "request_handoff",
      targetAssigneeId: "responder-b",
    },
  });

  const incoming = await service.get({
    tenantId: "provider-a",
    caseId: "case-visible",
    principalId: "principal-responder-b",
  });
  assert.equal(
    incoming?.aggregate.handoffTargetId,
    "responder-b",
  );
});
