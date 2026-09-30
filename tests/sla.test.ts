import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidTransitionError,
  createCase,
  evaluateCaseSla,
  executeCommand,
  replayCase,
  validateSlaPolicy,
  type CaseEvent,
  type CaseSlaPolicy,
} from "../src/index.ts";

const minute = 60_000;

function at(value: number): string {
  return new Date(Date.UTC(2026, 8, 25, 3, value, 0)).toISOString();
}

const policy: CaseSlaPolicy = {
  critical: {
    acknowledgeWithinMs: 2 * minute,
    assignWithinMs: 2 * minute,
    firstActionWithinMs: 2 * minute,
    handoffAcceptWithinMs: 2 * minute,
    completeWithinMs: 15 * minute,
  },
  high: {
    acknowledgeWithinMs: 5 * minute,
    assignWithinMs: 5 * minute,
    firstActionWithinMs: 5 * minute,
    handoffAcceptWithinMs: 5 * minute,
    completeWithinMs: 30 * minute,
  },
  normal: {
    acknowledgeWithinMs: 10 * minute,
    assignWithinMs: 5 * minute,
    firstActionWithinMs: 5 * minute,
    handoffAcceptWithinMs: 3 * minute,
    completeWithinMs: 60 * minute,
  },
  low: {
    acknowledgeWithinMs: 30 * minute,
    assignWithinMs: 30 * minute,
    firstActionWithinMs: 30 * minute,
    handoffAcceptWithinMs: 15 * minute,
    completeWithinMs: 180 * minute,
  },
};

function newCase(priority: "critical" | "high" | "normal" | "low" = "normal") {
  return createCase({
    id: "case-sla",
    tenantId: "provider-a",
    sourceAdapter: "test-adapter",
    sourceSignalId: "signal-sla",
    subjectId: "subject-sla",
    sourceType: "non_response",
    priority,
    createdAt: at(0),
  });
}

test("NEW Case exposes acknowledgement breach and stage aging", () => {
  const created = newCase();

  const evaluation = evaluateCaseSla(
    created.aggregate,
    [created.event],
    policy,
    at(12),
  );

  assert.equal(evaluation.currentStage, "acknowledge");
  assert.equal(evaluation.stageAgeMs, 12 * minute);
  assert.equal(evaluation.hasActiveBreach, true);
  assert.deepEqual(evaluation.breachedStages, ["acknowledge"]);
  assert.equal(evaluation.nextDeadlineAt, at(10));
  assert.deepEqual(evaluation.escalationRecommendations, [
    {
      type: "sla_breach",
      tenantId: "provider-a",
      caseId: "case-sla",
      stage: "acknowledge",
      dueAt: at(10),
      overdueMs: 2 * minute,
    },
  ]);
});

test("priority escalation re-evaluates original clocks instead of resetting them", () => {
  const created = newCase("normal");
  const changed = executeCommand(
    created.aggregate,
    1,
    {
      type: "set_priority",
      actorId: "dispatcher",
      priority: "critical",
    },
    at(8),
  );

  const events = [created.event, changed.event];
  const replayed = replayCase(events);

  assert.equal(replayed.priority, "critical");
  assert.equal(replayed.createdAt, at(0));

  const evaluation = evaluateCaseSla(
    replayed,
    events,
    policy,
    at(8),
  );

  assert.equal(evaluation.currentStage, "acknowledge");
  assert.equal(evaluation.stageAgeMs, 8 * minute);
  assert.equal(evaluation.nextDeadlineAt, at(2));
  assert.equal(evaluation.hasActiveBreach, true);
  assert.equal(
    evaluation.escalationRecommendations[0]?.overdueMs,
    6 * minute,
  );
});

test("handoff pending becomes the stalled stage until acceptance", () => {
  const events: CaseEvent[] = [];
  let { aggregate, event } = newCase();
  events.push(event);

  ({ aggregate, event } = executeCommand(
    aggregate,
    1,
    { type: "acknowledge", actorId: "dispatcher" },
    at(5),
  ));
  events.push(event);

  ({ aggregate, event } = executeCommand(
    aggregate,
    2,
    {
      type: "assign",
      actorId: "dispatcher",
      assigneeId: "responder-a",
    },
    at(8),
  ));
  events.push(event);

  ({ aggregate, event } = executeCommand(
    aggregate,
    3,
    { type: "start_action", actorId: "responder-a" },
    at(10),
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
    at(20),
  ));
  events.push(event);

  const pending = evaluateCaseSla(
    aggregate,
    events,
    policy,
    at(25),
  );

  assert.equal(pending.currentStage, "handoff_accept");
  assert.equal(pending.stageAgeMs, 5 * minute);
  assert.equal(pending.hasActiveBreach, true);
  assert.ok(pending.breachedStages.includes("handoff_accept"));

  ({ aggregate, event } = executeCommand(
    aggregate,
    5,
    { type: "accept_handoff", actorId: "responder-b" },
    at(26),
  ));
  events.push(event);

  const accepted = evaluateCaseSla(
    aggregate,
    events,
    policy,
    at(27),
  );

  const handoff = accepted.checkpoints.find(
    (item) => item.stage === "handoff_accept",
  );
  assert.equal(accepted.currentStage, "complete");
  assert.equal(accepted.stageAgeMs, minute);
  assert.equal(accepted.hasActiveBreach, false);
  assert.equal(handoff?.state, "breached");
  assert.equal(handoff?.completedAt, at(26));
  assert.equal(handoff?.overdueMs, 3 * minute);
});

test("historical late completion is recorded without an active escalation", () => {
  const tightPolicy: CaseSlaPolicy = {
    ...policy,
    normal: {
      ...policy.normal,
      completeWithinMs: 20 * minute,
    },
  };

  const events: CaseEvent[] = [];
  let { aggregate, event } = newCase();
  events.push(event);

  ({ aggregate, event } = executeCommand(
    aggregate,
    1,
    { type: "acknowledge", actorId: "dispatcher" },
    at(1),
  ));
  events.push(event);

  ({ aggregate, event } = executeCommand(
    aggregate,
    2,
    {
      type: "assign",
      actorId: "dispatcher",
      assigneeId: "responder-a",
    },
    at(2),
  ));
  events.push(event);

  ({ aggregate, event } = executeCommand(
    aggregate,
    3,
    { type: "start_action", actorId: "responder-a" },
    at(3),
  ));
  events.push(event);

  ({ aggregate, event } = executeCommand(
    aggregate,
    4,
    {
      type: "complete",
      actorId: "responder-a",
      outcome: "confirmed_safe",
      summary: "synthetic completion",
      evidence: [{ kind: "call", ref: "synthetic:call" }],
    },
    at(22),
  ));
  events.push(event);

  const evaluation = evaluateCaseSla(
    aggregate,
    events,
    tightPolicy,
    at(30),
  );

  const completion = evaluation.checkpoints.find(
    (item) => item.stage === "complete",
  );
  assert.equal(completion?.state, "breached");
  assert.equal(completion?.overdueMs, 2 * minute);
  assert.equal(evaluation.hasActiveBreach, false);
  assert.deepEqual(evaluation.escalationRecommendations, []);
});

test("priority changes require an active Case and a different priority", () => {
  const created = newCase();

  assert.throws(
    () =>
      executeCommand(
        created.aggregate,
        1,
        {
          type: "set_priority",
          actorId: "dispatcher",
          priority: "normal",
        },
        at(1),
      ),
    InvalidTransitionError,
  );
});

test("invalid SLA policy fails closed", () => {
  const invalid: CaseSlaPolicy = {
    ...policy,
    critical: {
      ...policy.critical,
      acknowledgeWithinMs: -1,
    },
  };

  assert.throws(() => validateSlaPolicy(invalid));
});
