import assert from "node:assert/strict";
import test from "node:test";

import {
  CareOpsHttpClientError,
  LiveConsoleWorkspace,
  createCase,
  executeCommand,
  type BrowserAuthSessionStatus,
  type CareOpsSessionClient,
  type CaseCapabilitiesProjection,
  type OperatorContextProjection,
  type CareOpsSessionListener,
  type CareOpsSessionSnapshot,
  type CaseCommandIntent,
  type CaseMetrics,
  type CaseOperationResult,
  type CaseQueueProjection,
  type StoredCase,
} from "../src/index.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;

  const promise = new Promise<T>(
    (res, rej) => {
      resolve = res;
      reject = rej;
    },
  );

  return { promise, resolve, reject };
}

function storedCase(
  caseId: string,
  status: "NEW" | "ACKNOWLEDGED" = "NEW",
): StoredCase {
  const created = createCase({
    id: caseId,
    tenantId: "provider-a",
    sourceAdapter: "test",
    sourceSignalId: "signal-" + caseId,
    subjectId: "subject-" + caseId,
    sourceType: "non_response",
    priority: "high",
    createdAt:
      "2026-09-26T02:00:00.000Z",
  });

  if (status === "NEW") {
    return {
      aggregate: created.aggregate,
      events: [created.event],
    };
  }

  const acknowledged = executeCommand(
    created.aggregate,
    1,
    {
      type: "acknowledge",
      actorId: "dispatcher-a",
    },
    "2026-09-26T02:01:00.000Z",
  );

  return {
    aggregate: acknowledged.aggregate,
    events: [
      created.event,
      acknowledged.event,
    ],
  };
}

const emptyMetrics: CaseMetrics = {
  timeToAcknowledgeMs: null,
  timeToAssignmentMs: null,
  timeToFirstActionMs: null,
  timeToCompletionMs: null,
  handoffCount: 0,
  reopenCount: 0,
};

function queue(
  caseIds: readonly string[],
): CaseQueueProjection {
  return {
    tenantId: "provider-a",
    evaluatedAt:
      "2026-09-26T02:00:00.000Z",
    items: caseIds.map((caseId) => ({
      tenantId: "provider-a",
      caseId,
      subjectId: "subject-" + caseId,
      priority: "high",
      status: "NEW",
      assigneeId: null,
      handoffTargetId: null,
      createdAt:
        "2026-09-26T02:00:00.000Z",
      currentStage: "acknowledge",
      stageAgeMs: 0,
      nextDeadlineAt:
        "2026-09-26T02:10:00.000Z",
      hasActiveBreach: false,
      maxActiveOverdueMs: 0,
      breachedStages: [],
      attentionReason:
        "unacknowledged",
    })),
    summary: {
      total: caseIds.length,
      breached: 0,
      unacknowledged:
        caseIds.length,
      unassigned: 0,
      handoffPending: 0,
      byPriority: {
        critical: 0,
        high: caseIds.length,
        normal: 0,
        low: 0,
      },
    },
  };
}

class FakeSession
implements CareOpsSessionClient {
  session: CareOpsSessionSnapshot = {
    state: "ready",
    expiresAt: null,
    generation: 1,
  };

  readonly listeners =
    new Set<CareOpsSessionListener>();

  operatorContextImpl:
    (
      tenantId: string,
    ) => Promise<OperatorContextProjection> =
    async (tenantId) => ({
      tenantId,
      actorId: "operator-a",
      roles: ["supervisor"],
      queueVisibility: "tenant",
    });

  caseCapabilitiesImpl:
    (
      tenantId: string,
      caseId: string,
    ) => Promise<CaseCapabilitiesProjection> =
    async (tenantId, caseId) => {
      const stored = storedCase(caseId);
      return {
        tenantId,
        caseId,
        version: stored.aggregate.version,
        status: stored.aggregate.status,
        operator: {
          tenantId,
          actorId: "operator-a",
          roles: ["supervisor"],
          queueVisibility: "tenant",
        },
        commands: [],
      };
    };

  queueImpl:
    (tenantId: string) =>
      Promise<CaseQueueProjection> =
    async () => queue([]);

  getCaseImpl:
    (
      tenantId: string,
      caseId: string,
    ) => Promise<StoredCase> =
    async (_tenantId, caseId) =>
      storedCase(caseId);

  metricsImpl:
    (
      tenantId: string,
      caseId: string,
    ) => Promise<CaseMetrics> =
    async () => emptyMetrics;

  executeImpl:
    (
      tenantId: string,
      caseId: string,
      expectedVersion: number,
      command: CaseCommandIntent,
    ) => Promise<CaseOperationResult> =
    async () => {
      throw new Error(
        "executeImpl not configured",
      );
    };

  executeCalls: Array<{
    tenantId: string;
    caseId: string;
    expectedVersion: number;
    command: CaseCommandIntent;
  }> = [];

  async initialize():
  Promise<CareOpsSessionSnapshot> {
    return { ...this.session };
  }

  snapshot(): CareOpsSessionSnapshot {
    return { ...this.session };
  }

  subscribe(
    listener: CareOpsSessionListener,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async signOut(): Promise<void> {
    this.emit({
      status: "signed_out",
    });
  }

  dispose(): void {}

  operatorContext(
    tenantId: string,
  ): Promise<OperatorContextProjection> {
    return this.operatorContextImpl(
      tenantId,
    );
  }

  caseCapabilities(
    tenantId: string,
    caseId: string,
  ): Promise<CaseCapabilitiesProjection> {
    return this.caseCapabilitiesImpl(
      tenantId,
      caseId,
    );
  }

  queue(
    tenantId: string,
  ): Promise<CaseQueueProjection> {
    return this.queueImpl(tenantId);
  }

  getCase(
    tenantId: string,
    caseId: string,
  ): Promise<StoredCase> {
    return this.getCaseImpl(
      tenantId,
      caseId,
    );
  }

  metrics(
    tenantId: string,
    caseId: string,
  ): Promise<CaseMetrics> {
    return this.metricsImpl(
      tenantId,
      caseId,
    );
  }

  execute(
    tenantId: string,
    caseId: string,
    expectedVersion: number,
    command: CaseCommandIntent,
  ): Promise<CaseOperationResult> {
    this.executeCalls.push({
      tenantId,
      caseId,
      expectedVersion,
      command,
    });

    return this.executeImpl(
      tenantId,
      caseId,
      expectedVersion,
      command,
    );
  }

  emit(
    status: BrowserAuthSessionStatus,
  ): void {
    this.session =
      status.status === "authenticated"
        ? {
            state: "ready",
            expiresAt:
              status.expiresAt ?? null,
            generation:
              this.session.generation + 1,
          }
        : {
            state: "signed_out",
            expiresAt: null,
            generation:
              this.session.generation + 1,
          };

    for (const listener of this.listeners) {
      listener({ ...this.session });
    }
  }
}

test("workspace initializes authorized Queue without owning auth state", async () => {
  const session = new FakeSession();
  session.queueImpl =
    async () =>
      queue(["case-a", "case-b"]);

  let tick = 0;
  const workspace =
    new LiveConsoleWorkspace({
      tenantId: "provider-a",
      session,
      now: () =>
        `2026-09-26T02:0${tick++}:00.000Z`,
    });

  await workspace.initialize();

  const snapshot = workspace.snapshot();

  assert.equal(
    snapshot.session.state,
    "ready",
  );
  assert.equal(
    snapshot.queue.state,
    "ready",
  );
  assert.deepEqual(
    snapshot.queue.data?.items.map(
      (item) => item.caseId,
    ),
    ["case-a", "case-b"],
  );
  assert.ok(
    snapshot.lastSuccessfulRefreshAt,
  );
  assert.equal(
    snapshot.operator.state,
    "ready",
  );
  assert.equal(
    snapshot.operator.data?.actorId,
    "operator-a",
  );

  const serialized =
    JSON.stringify(snapshot);

  for (const secretMarker of [
    "access-token",
    "refresh-token",
    "service_role",
    "service-role",
  ]) {
    assert.equal(
      serialized.includes(secretMarker),
      false,
    );
  }

  assert.equal(
    Object.hasOwn(
      snapshot.session,
      "accessToken",
    ),
    false,
  );
  assert.equal(
    Object.hasOwn(
      snapshot.session,
      "provider",
    ),
    false,
  );
});

test("older Case selection response cannot overwrite a newer selection", async () => {
  const session = new FakeSession();

  const aDetail = deferred<StoredCase>();
  const aMetrics = deferred<CaseMetrics>();

  session.getCaseImpl =
    async (_tenantId, caseId) => {
      if (caseId === "case-a") {
        return await aDetail.promise;
      }
      return storedCase("case-b");
    };

  session.metricsImpl =
    async (_tenantId, caseId) => {
      if (caseId === "case-a") {
        return await aMetrics.promise;
      }
      return {
        ...emptyMetrics,
        handoffCount: 2,
      };
    };

  const workspace =
    new LiveConsoleWorkspace({
      tenantId: "provider-a",
      session,
    });

  const selectA =
    workspace.selectCase("case-a");

  const selectB =
    workspace.selectCase("case-b");

  await selectB;

  aDetail.resolve(storedCase("case-a"));
  aMetrics.resolve(emptyMetrics);
  await selectA;

  const snapshot = workspace.snapshot();

  assert.equal(
    snapshot.selectedCaseId,
    "case-b",
  );
  assert.equal(
    snapshot.detail.data?.aggregate.id,
    "case-b",
  );
  assert.equal(
    snapshot.metrics.data?.handoffCount,
    2,
  );
  assert.equal(
    snapshot.capabilities.data?.caseId,
    "case-b",
  );
});

test("successful command uses current Case version then refreshes canonical state and Queue", async () => {
  const session = new FakeSession();
  let queueCalls = 0;
  let detailCalls = 0;

  const before = storedCase("case-a");
  const after =
    storedCase(
      "case-a",
      "ACKNOWLEDGED",
    );

  session.queueImpl = async () => {
    queueCalls += 1;
    return queue(["case-a"]);
  };

  session.getCaseImpl =
    async () => {
      detailCalls += 1;
      return detailCalls === 1
        ? before
        : after;
    };

  session.executeImpl =
    async (
      _tenantId,
      _caseId,
      expectedVersion,
      command,
    ) => {
      assert.equal(
        expectedVersion,
        before.aggregate.version,
      );
      assert.deepEqual(
        command,
        { type: "acknowledge" },
      );

      return {
        aggregate: after.aggregate,
        event: after.events[1]!,
      };
    };

  const workspace =
    new LiveConsoleWorkspace({
      tenantId: "provider-a",
      session,
    });

  await workspace.initialize();
  await workspace.selectCase("case-a");
  await workspace.execute({
    type: "acknowledge",
  });

  assert.equal(
    session.executeCalls.length,
    1,
  );
  assert.equal(
    session.executeCalls[0]?.expectedVersion,
    1,
  );
  assert.equal(
    workspace.snapshot()
      .detail.data?.aggregate.version,
    2,
  );
  assert.equal(
    workspace.snapshot()
      .detail.data?.aggregate.status,
    "ACKNOWLEDGED",
  );
  assert.ok(queueCalls >= 2);
  assert.ok(detailCalls >= 2);
});

test("409 records stale conflict, refetches latest Case, and never replays command", async () => {
  const session = new FakeSession();
  let detailCalls = 0;

  const oldCase = storedCase("case-a");
  const latestCase =
    storedCase(
      "case-a",
      "ACKNOWLEDGED",
    );

  session.getCaseImpl =
    async () => {
      detailCalls += 1;
      return detailCalls === 1
        ? oldCase
        : latestCase;
    };

  session.queueImpl =
    async () => queue(["case-a"]);

  session.executeImpl =
    async () => {
      throw new CareOpsHttpClientError({
        status: 409,
        code: "CASE_CONFLICT",
        message:
          "Case version conflict",
        requestId: "req-conflict",
        details: {
          expectedVersion: 1,
          actualVersion: 2,
        },
      });
    };

  const workspace =
    new LiveConsoleWorkspace({
      tenantId: "provider-a",
      session,
    });

  await workspace.initialize();
  await workspace.selectCase("case-a");
  await workspace.execute({
    type: "acknowledge",
  });

  const snapshot = workspace.snapshot();

  assert.equal(
    session.executeCalls.length,
    1,
    "stale command must not be replayed",
  );
  assert.deepEqual(
    snapshot.mutation.staleConflict,
    {
      expectedVersion: 1,
      actualVersion: 2,
    },
  );
  assert.equal(
    snapshot.mutation.error?.status,
    409,
  );
  assert.equal(
    snapshot.detail.data?.aggregate.version,
    2,
  );
  assert.equal(
    snapshot.detail.data?.aggregate.status,
    "ACKNOWLEDGED",
  );
});

test("403 and 422 remain visible operator errors without clearing session", async () => {
  for (const status of [403, 422]) {
    const session = new FakeSession();
    session.getCaseImpl =
      async () => storedCase("case-a");
    session.executeImpl =
      async () => {
        throw new CareOpsHttpClientError({
          status,
          code:
            status === 403
              ? "FORBIDDEN"
              : "INVALID_TRANSITION",
          message:
            status === 403
              ? "Access denied"
              : "Case transition is not allowed",
          requestId:
            "req-" + status,
        });
      };

    const workspace =
      new LiveConsoleWorkspace({
        tenantId: "provider-a",
        session,
      });

    await workspace.selectCase("case-a");
    await workspace.execute({
      type: "acknowledge",
    });

    const snapshot =
      workspace.snapshot();

    assert.equal(
      snapshot.session.state,
      "ready",
    );
    assert.equal(
      snapshot.mutation.error?.status,
      status,
    );
    assert.equal(
      snapshot.mutation.staleConflict,
      null,
    );
  }
});

test("session loss invalidates in-flight responses and clears operational workspace data", async () => {
  const session = new FakeSession();
  const detail = deferred<StoredCase>();
  const metrics = deferred<CaseMetrics>();

  session.queueImpl =
    async () => queue(["case-a"]);
  session.getCaseImpl =
    async () => await detail.promise;
  session.metricsImpl =
    async () => await metrics.promise;

  const workspace =
    new LiveConsoleWorkspace({
      tenantId: "provider-a",
      session,
    });

  await workspace.initialize();

  const pending =
    workspace.selectCase("case-a");

  session.emit({
    status: "signed_out",
  });

  detail.resolve(storedCase("case-a"));
  metrics.resolve(emptyMetrics);
  await pending;

  const snapshot = workspace.snapshot();

  assert.equal(
    snapshot.session.state,
    "signed_out",
  );
  assert.equal(
    snapshot.queue.data,
    null,
  );
  assert.equal(
    snapshot.selectedCaseId,
    null,
  );
  assert.equal(
    snapshot.detail.data,
    null,
  );
  assert.equal(
    snapshot.metrics.data,
    null,
  );
  assert.equal(
    snapshot.capabilities.data,
    null,
  );
  assert.equal(
    snapshot.operator.data,
    null,
  );
  assert.equal(
    snapshot.mutation.pending,
    false,
  );
});

test("completed Case may remain selected as historical detail after leaving active Queue", async () => {
  const session = new FakeSession();
  session.queueImpl =
    async () => queue(["case-a"]);
  session.getCaseImpl =
    async () => storedCase("case-a");

  const workspace =
    new LiveConsoleWorkspace({
      tenantId: "provider-a",
      session,
    });

  await workspace.initialize();
  await workspace.selectCase("case-a");

  session.queueImpl =
    async () => queue([]);

  await workspace.refreshQueue();

  const snapshot = workspace.snapshot();

  assert.equal(
    snapshot.selectedCaseId,
    "case-a",
  );
  assert.equal(
    snapshot.selectedCaseActive,
    false,
  );
  assert.equal(
    snapshot.detail.data?.aggregate.id,
    "case-a",
  );
});
