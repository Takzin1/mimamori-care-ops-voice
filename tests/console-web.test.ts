import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ConsoleWebInputError,
  buildConsoleCommandIntent,
  createCase,
  projectConsoleWebModel,
  type LiveConsoleWorkspaceSnapshot,
} from "../src/index.ts";

function snapshot():
LiveConsoleWorkspaceSnapshot {
  const created = createCase({
    id: "case-b",
    tenantId: "provider-a",
    sourceAdapter: "test",
    sourceSignalId: "signal-b",
    subjectId: "subject-b",
    sourceType: "non_response",
    priority: "high",
    createdAt:
      "2026-09-26T04:00:00.000Z",
  });

  return {
    tenantId: "provider-a",
    session: {
      state: "ready",
      expiresAt: null,
      generation: 1,
    },
    operator: {
      state: "ready",
      data: {
        tenantId: "provider-a",
        actorId: "responder-a",
        roles: ["responder"],
        queueVisibility: "responder",
      },
      error: null,
    },
    queue: {
      state: "ready",
      data: {
        tenantId: "provider-a",
        evaluatedAt:
          "2026-09-26T04:05:00.000Z",
        items: [
          {
            tenantId: "provider-a",
            caseId: "case-b",
            subjectId: "subject-b",
            priority: "high",
            status: "IN_PROGRESS",
            assigneeId: "responder-a",
            handoffTargetId: null,
            createdAt:
              "2026-09-26T04:00:00.000Z",
            currentStage: "complete",
            stageAgeMs: 5 * 60_000,
            nextDeadlineAt:
              "2026-09-26T04:30:00.000Z",
            hasActiveBreach: true,
            maxActiveOverdueMs:
              2 * 60_000,
            breachedStages: ["complete"],
            attentionReason:
              "sla_breach",
          },
          {
            tenantId: "provider-a",
            caseId: "case-a",
            subjectId: "subject-a",
            priority: "normal",
            status: "NEW",
            assigneeId: null,
            handoffTargetId: null,
            createdAt:
              "2026-09-26T04:01:00.000Z",
            currentStage: "acknowledge",
            stageAgeMs: 4 * 60_000,
            nextDeadlineAt:
              "2026-09-26T04:11:00.000Z",
            hasActiveBreach: false,
            maxActiveOverdueMs: 0,
            breachedStages: [],
            attentionReason:
              "unacknowledged",
          },
        ],
        summary: {
          total: 2,
          breached: 1,
          unacknowledged: 1,
          unassigned: 0,
          handoffPending: 0,
          byPriority: {
            critical: 0,
            high: 1,
            normal: 1,
            low: 0,
          },
        },
      },
      error: null,
    },
    selectedCaseId: "case-b",
    selectedCaseActive: true,
    detail: {
      state: "ready",
      data: {
        aggregate: {
          ...created.aggregate,
          status: "IN_PROGRESS",
          assigneeId: "responder-a",
          firstActionAt:
            "2026-09-26T04:02:00.000Z",
          version: 4,
        },
        events: [created.event],
      },
      error: null,
    },
    metrics: {
      state: "ready",
      data: {
        timeToAcknowledgeMs:
          60_000,
        timeToAssignmentMs:
          90_000,
        timeToFirstActionMs:
          120_000,
        timeToCompletionMs: null,
        handoffCount: 0,
        reopenCount: 0,
      },
      error: null,
    },
    capabilities: {
      state: "ready",
      data: {
        tenantId: "provider-a",
        caseId: "case-b",
        version: 4,
        status: "IN_PROGRESS",
        operator: {
          tenantId: "provider-a",
          actorId: "responder-a",
          roles: ["responder"],
          queueVisibility: "responder",
        },
        commands: [
          {
            type: "complete",
            requires: [
              "outcome",
              "summary",
              "evidence",
            ],
          },
        ],
      },
      error: null,
    },
    mutation: {
      pending: false,
      error: null,
      staleConflict: null,
    },
    lastSuccessfulRefreshAt:
      "2026-09-26T04:05:00.000Z",
    generation: 3,
  };
}

test("web view preserves server Queue order and capability action list", () => {
  const model =
    projectConsoleWebModel(
      snapshot(),
    );

  assert.deepEqual(
    model.queue.cards.map(
      (card) => card.caseId,
    ),
    ["case-b", "case-a"],
  );

  assert.equal(
    model.queue.cards[0]
      ?.hasActiveBreach,
    true,
  );
  assert.equal(
    model.queue.cards[0]
      ?.overdueMinutes,
    2,
  );

  assert.deepEqual(
    model.actions,
    [
      {
        type: "complete",
        label: "支援完了を記録",
        requires: [
          "outcome",
          "summary",
          "evidence",
        ],
      },
    ],
  );

  assert.equal(
    model.actions.some(
      (action) =>
        action.type ===
        "request_handoff",
    ),
    false,
    "renderer must not invent actions missing from server capabilities",
  );
});

test("web view carries safe operator, metrics and historical-state flags", () => {
  const value = snapshot();
  value.selectedCaseActive = false;

  const model =
    projectConsoleWebModel(value);

  assert.deepEqual(model.operator, {
    actorId: "responder-a",
    roles: ["responder"],
    queueVisibility: "responder",
  });
  assert.equal(
    model.selected?.active,
    false,
  );
  assert.equal(
    model.metrics?.ttaMinutes,
    1,
  );
  assert.equal(
    model.metrics?.firstActionMinutes,
    2,
  );
});

test("command builder maps renderer values into strict Case intents", () => {
  assert.deepEqual(
    buildConsoleCommandIntent(
      "assign",
      {
        assigneeId: " responder-b ",
      },
    ),
    {
      type: "assign",
      assigneeId: "responder-b",
    },
  );

  assert.deepEqual(
    buildConsoleCommandIntent(
      "complete",
      {
        outcome: "confirmed_safe",
        summary:
          " Synthetic phone check ",
        evidenceKind: "call",
        evidenceRef:
          " synthetic:call:001 ",
      },
    ),
    {
      type: "complete",
      outcome: "confirmed_safe",
      summary:
        "Synthetic phone check",
      evidence: [
        {
          kind: "call",
          ref: "synthetic:call:001",
        },
      ],
    },
  );

  assert.deepEqual(
    buildConsoleCommandIntent(
      "reopen",
      {
        reason:
          " renewed concern ",
      },
    ),
    {
      type: "reopen",
      reason: "renewed concern",
    },
  );
});

test("command builder rejects invalid or missing renderer values", () => {
  assert.throws(
    () =>
      buildConsoleCommandIntent(
        "set_priority",
        {
          priority:
            "not-a-priority",
        },
      ),
    ConsoleWebInputError,
  );

  assert.throws(
    () =>
      buildConsoleCommandIntent(
        "complete",
        {
          outcome: "confirmed_safe",
          summary: "",
          evidenceKind: "call",
          evidenceRef: "x",
        },
      ),
    ConsoleWebInputError,
  );
});

test("DOM renderer source has no dynamic HTML injection, credential, storage or network primitive", async () => {
  const source = await readFile(
    new URL(
      "../src/console-web/renderer.ts",
      import.meta.url,
    ),
    "utf8",
  );

  for (const forbidden of [
    "innerHTML",
    "outerHTML",
    "insertAdjacentHTML",
    "localStorage",
    "sessionStorage",
    "document.cookie",
    "indexedDB",
    "fetch(",
    "service_role",
    "service-role",
    "supabase",
    "principalId",
  ]) {
    assert.equal(
      source
        .toLowerCase()
        .includes(
          forbidden.toLowerCase(),
        ),
      false,
      `${forbidden} must stay outside the DOM renderer`,
    );
  }

  assert.ok(
    source.includes(
      "textContent",
    ),
  );
  assert.ok(
    source.includes(
      "replaceChildren",
    ),
  );
  assert.ok(
    source.includes(
      "action.requires",
    ),
  );
});


test("command builder mirrors server input length limits", () => {
  assert.throws(
    () =>
      buildConsoleCommandIntent(
        "assign",
        {
          assigneeId: "a".repeat(129),
        },
      ),
    ConsoleWebInputError,
  );

  assert.throws(
    () =>
      buildConsoleCommandIntent(
        "complete",
        {
          outcome: "confirmed_safe",
          summary: "s".repeat(4001),
          evidenceKind: "call",
          evidenceRef: "ref",
        },
      ),
    ConsoleWebInputError,
  );

  assert.throws(
    () =>
      buildConsoleCommandIntent(
        "complete",
        {
          outcome: "confirmed_safe",
          summary: "ok",
          evidenceKind: "call",
          evidenceRef: "e".repeat(1001),
        },
      ),
    ConsoleWebInputError,
  );

  assert.throws(
    () =>
      buildConsoleCommandIntent(
        "reopen",
        {
          reason: "r".repeat(1001),
        },
      ),
    ConsoleWebInputError,
  );
});


test("command builder rejects unsafe actor identifier syntax", () => {
  assert.throws(
    () =>
      buildConsoleCommandIntent(
        "assign",
        {
          assigneeId:
            "responder-a,or(actor_id.eq.attacker)",
        },
      ),
    ConsoleWebInputError,
  );

  assert.throws(
    () =>
      buildConsoleCommandIntent(
        "request_handoff",
        {
          targetAssigneeId:
            "responder unsafe",
        },
      ),
    ConsoleWebInputError,
  );
});
