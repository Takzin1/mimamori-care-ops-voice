import assert from "node:assert/strict";
import test from "node:test";

import {
  CaseConflictError,
  InvalidTransitionError,
  calculateCaseMetrics,
  createCase,
  executeCommand,
  replayCase,
  type CaseEvent,
} from "../src/core/index.ts";

function at(minute: number): string {
  return new Date(Date.UTC(2026, 8, 25, 0, minute, 0)).toISOString();
}

test("last-mile case completes through claim, action, handoff, evidence, and close", () => {
  const events: CaseEvent[] = [];
  let { aggregate, event } = createCase({
    id: "case-001",
    tenantId: "tenant-a",
    sourceAdapter: "test-adapter",
    sourceSignalId: "signal-001",
    priority: "normal",
    subjectId: "subject-001",
    sourceType: "non_response",
    createdAt: at(0),
  });
  events.push(event);

  ({ aggregate, event } = executeCommand(
    aggregate,
    1,
    { type: "acknowledge", actorId: "dispatcher" },
    at(2),
  ));
  events.push(event);

  ({ aggregate, event } = executeCommand(
    aggregate,
    2,
    { type: "assign", actorId: "dispatcher", assigneeId: "responder-a" },
    at(4),
  ));
  events.push(event);

  ({ aggregate, event } = executeCommand(
    aggregate,
    3,
    { type: "start_action", actorId: "responder-a" },
    at(5),
  ));
  events.push(event);

  ({ aggregate, event } = executeCommand(
    aggregate,
    4,
    {
      type: "request_handoff",
      actorId: "responder-a",
      targetAssigneeId: "responder-b",
    },
    at(8),
  ));
  events.push(event);

  assert.equal(aggregate.status, "HANDOFF_PENDING");
  assert.equal(
    aggregate.assigneeId,
    "responder-a",
    "outgoing responder remains accountable until acceptance",
  );

  ({ aggregate, event } = executeCommand(
    aggregate,
    5,
    { type: "accept_handoff", actorId: "responder-b" },
    at(10),
  ));
  events.push(event);

  assert.equal(aggregate.status, "IN_PROGRESS");
  assert.equal(aggregate.assigneeId, "responder-b");

  ({ aggregate, event } = executeCommand(
    aggregate,
    6,
    {
      type: "complete",
      actorId: "responder-b",
      outcome: "confirmed_safe",
      summary: "本人へ電話し安全を確認",
      evidence: [{ kind: "call", ref: "call-log:001" }],
    },
    at(20),
  ));
  events.push(event);

  assert.equal(aggregate.status, "COMPLETED");
  assert.equal(aggregate.completion?.completedBy, "responder-b");

  ({ aggregate, event } = executeCommand(
    aggregate,
    7,
    { type: "close", actorId: "supervisor" },
    at(22),
  ));
  events.push(event);

  assert.equal(aggregate.status, "CLOSED");
  assert.deepEqual(replayCase(events), aggregate);

  const metrics = calculateCaseMetrics(events);
  assert.equal(metrics.timeToAcknowledgeMs, 2 * 60_000);
  assert.equal(metrics.timeToAssignmentMs, 4 * 60_000);
  assert.equal(metrics.timeToFirstActionMs, 5 * 60_000);
  assert.equal(metrics.timeToCompletionMs, 20 * 60_000);
  assert.equal(metrics.handoffCount, 1);
});

test("stale version is rejected before transition", () => {
  const { aggregate } = createCase({
    id: "case-002",
    tenantId: "tenant-a",
    sourceAdapter: "test-adapter",
    sourceSignalId: "signal-002",
    priority: "normal",
    subjectId: "subject-002",
    sourceType: "sos",
    createdAt: at(0),
  });

  assert.throws(
    () =>
      executeCommand(
        aggregate,
        0,
        { type: "acknowledge", actorId: "dispatcher" },
        at(1),
      ),
    CaseConflictError,
  );
});

test("handoff cannot be accepted by anyone other than the requested target", () => {
  let { aggregate } = createCase({
    id: "case-003",
    tenantId: "tenant-a",
    sourceAdapter: "test-adapter",
    sourceSignalId: "signal-003",
    priority: "normal",
    subjectId: "subject-003",
    sourceType: "unwell",
    createdAt: at(0),
  });

  aggregate = executeCommand(
    aggregate,
    1,
    { type: "acknowledge", actorId: "dispatcher" },
    at(1),
  ).aggregate;
  aggregate = executeCommand(
    aggregate,
    2,
    { type: "assign", actorId: "dispatcher", assigneeId: "responder-a" },
    at(2),
  ).aggregate;
  aggregate = executeCommand(
    aggregate,
    3,
    { type: "start_action", actorId: "responder-a" },
    at(3),
  ).aggregate;
  aggregate = executeCommand(
    aggregate,
    4,
    {
      type: "request_handoff",
      actorId: "responder-a",
      targetAssigneeId: "responder-b",
    },
    at(4),
  ).aggregate;

  assert.throws(
    () =>
      executeCommand(
        aggregate,
        5,
        { type: "accept_handoff", actorId: "responder-c" },
        at(5),
      ),
    InvalidTransitionError,
  );
});

test("support completion requires evidence", () => {
  let { aggregate } = createCase({
    id: "case-004",
    tenantId: "tenant-a",
    sourceAdapter: "test-adapter",
    sourceSignalId: "signal-004",
    priority: "normal",
    subjectId: "subject-004",
    sourceType: "welfare_need_help",
    createdAt: at(0),
  });

  aggregate = executeCommand(
    aggregate,
    1,
    { type: "acknowledge", actorId: "dispatcher" },
    at(1),
  ).aggregate;
  aggregate = executeCommand(
    aggregate,
    2,
    { type: "assign", actorId: "dispatcher", assigneeId: "responder-a" },
    at(2),
  ).aggregate;
  aggregate = executeCommand(
    aggregate,
    3,
    { type: "start_action", actorId: "responder-a" },
    at(3),
  ).aggregate;

  assert.throws(
    () =>
      executeCommand(
        aggregate,
        4,
        {
          type: "complete",
          actorId: "responder-a",
          outcome: "confirmed_safe",
          summary: "確認済み",
          evidence: [],
        },
        at(4),
      ),
    InvalidTransitionError,
  );
});

test("case cannot jump directly from NEW to completion", () => {
  const { aggregate } = createCase({
    id: "case-005",
    tenantId: "tenant-a",
    sourceAdapter: "test-adapter",
    sourceSignalId: "signal-005",
    priority: "normal",
    subjectId: "subject-005",
    sourceType: "manual",
    createdAt: at(0),
  });

  assert.throws(
    () =>
      executeCommand(
        aggregate,
        1,
        {
          type: "complete",
          actorId: "responder-a",
          outcome: "other",
          summary: "direct close",
          evidence: [{ kind: "note", ref: "note:001" }],
        },
        at(1),
      ),
    InvalidTransitionError,
  );
});
