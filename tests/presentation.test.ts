import assert from "node:assert/strict";
import test from "node:test";

import {
  createCase,
  executeCommand,
  presentCaseDetail,
  presentCaseQueue,
  projectCaseQueue,
  type CaseEvent,
  type CaseSlaPolicy,
} from "../src/index.ts";

const minute = 60_000;

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

test("Console presenter maps Queue and Case history without inventing state", () => {
  const created = createCase({
    id: "case-present",
    tenantId: "provider-a",
    sourceAdapter: "test",
    sourceSignalId: "signal-present",
    subjectId: "subject-present",
    sourceType: "non_response",
    priority: "high",
    createdAt: "2026-09-25T06:00:00.000Z",
  });

  const events: CaseEvent[] = [created.event];
  let aggregate = created.aggregate;

  const acknowledge = executeCommand(
    aggregate,
    aggregate.version,
    {
      type: "acknowledge",
      actorId: "dispatcher",
    },
    "2026-09-25T06:18:00.000Z",
  );
  aggregate = acknowledge.aggregate;
  events.push(acknowledge.event);

  const assign = executeCommand(
    aggregate,
    aggregate.version,
    {
      type: "assign",
      actorId: "dispatcher",
      assigneeId: "responder-a",
    },
    "2026-09-25T06:20:00.000Z",
  );
  aggregate = assign.aggregate;
  events.push(assign.event);

  const stored = {
    aggregate,
    events,
  };

  const queue = projectCaseQueue(
    [stored],
    "provider-a",
    { type: "tenant" },
    policy,
    "2026-09-25T06:21:00.000Z",
  );

  const queueView = presentCaseQueue(queue);
  assert.equal(queueView.cards.length, 1);
  assert.deepEqual(queueView.cards[0], {
    caseId: "case-present",
    subjectId: "subject-present",
    priority: "high",
    status: "ASSIGNED",
    attentionReason: "active",
    currentStage: "first_action",
    assigneeId: "responder-a",
    handoffTargetId: null,
    stageAgeMinutes: 1,
    nextDeadlineAt: "2026-09-25T06:40:00.000Z",
    overdueMinutes: 0,
  });

  const detail = presentCaseDetail(
    stored,
    policy,
    "2026-09-25T06:21:00.000Z",
  );

  assert.equal(detail.version, aggregate.version);
  assert.equal(detail.assigneeId, "responder-a");
  assert.equal(detail.metrics.timeToAcknowledgeMs, 18 * minute);
  assert.equal(detail.metrics.timeToAssignmentMs, 20 * minute);
  assert.deepEqual(
    detail.timeline.map((item) => item.title),
    ["Case発生", "確認済み", "担当確定"],
  );
  assert.equal(
    detail.timeline[2]?.detail,
    "担当: responder-a",
  );
});
