import assert from "node:assert/strict";
import test from "node:test";

import {
  CaseConflictError,
  InMemoryCaseRepository,
  SignalReplayMismatchError,
  createCase,
  executeCommand,
  replayCase,
} from "../src/index.ts";

function at(minute: number): string {
  return new Date(Date.UTC(2026, 8, 25, 1, minute, 0)).toISOString();
}

test("tenant boundary isolates identical case ids", async () => {
  const repo = new InMemoryCaseRepository();

  const a = createCase({
    id: "case-shared",
    tenantId: "provider-a",
    sourceAdapter: "adapter-a",
    sourceSignalId: "sig-shared-a",
    priority: "normal",
    subjectId: "subject-a",
    sourceType: "non_response",
    createdAt: at(0),
  });
  const b = createCase({
    id: "case-shared",
    tenantId: "provider-b",
    sourceAdapter: "adapter-a",
    sourceSignalId: "sig-shared-b",
    priority: "normal",
    subjectId: "subject-b",
    sourceType: "sos",
    createdAt: at(0),
  });

  await repo.create(a.event);
  await repo.create(b.event);

  const storedA = await repo.load("provider-a", "case-shared");
  const storedB = await repo.load("provider-b", "case-shared");

  assert.equal(storedA?.aggregate.subjectId, "subject-a");
  assert.equal(storedB?.aggregate.subjectId, "subject-b");
  assert.equal(await repo.load("provider-c", "case-shared"), null);
});

test("compare-and-set allows only the first stale concurrent append", async () => {
  const repo = new InMemoryCaseRepository();
  const created = createCase({
    id: "case-race",
    tenantId: "provider-a",
    sourceAdapter: "adapter-a",
    sourceSignalId: "sig-race",
    priority: "normal",
    subjectId: "subject-race",
    sourceType: "unwell",
    createdAt: at(0),
  });
  await repo.create(created.event);

  const first = executeCommand(
    created.aggregate,
    1,
    { type: "acknowledge", actorId: "dispatcher-a" },
    at(1),
  );
  const staleSecond = executeCommand(
    created.aggregate,
    1,
    { type: "acknowledge", actorId: "dispatcher-b" },
    at(1),
  );

  await repo.append({
    tenantId: "provider-a",
    caseId: "case-race",
    expectedVersion: 1,
    event: first.event,
  });

  await assert.rejects(
    repo.append({
      tenantId: "provider-a",
      caseId: "case-race",
      expectedVersion: 1,
      event: staleSecond.event,
    }),
    CaseConflictError,
  );

  const stored = await repo.load("provider-a", "case-race");
  assert.equal(stored?.aggregate.version, 2);
  assert.equal(stored?.events.length, 2);
});

test("snapshot and append-only stream remain replay-equivalent", async () => {
  const repo = new InMemoryCaseRepository();
  const created = createCase({
    id: "case-replay",
    tenantId: "provider-a",
    sourceAdapter: "adapter-a",
    sourceSignalId: "sig-replay",
    priority: "normal",
    subjectId: "subject-replay",
    sourceType: "manual",
    createdAt: at(0),
  });
  await repo.create(created.event);

  const acknowledged = executeCommand(
    created.aggregate,
    1,
    { type: "acknowledge", actorId: "dispatcher" },
    at(1),
  );
  await repo.append({
    tenantId: "provider-a",
    caseId: "case-replay",
    expectedVersion: 1,
    event: acknowledged.event,
  });

  const assigned = executeCommand(
    acknowledged.aggregate,
    2,
    { type: "assign", actorId: "dispatcher", assigneeId: "responder-a" },
    at(2),
  );
  await repo.append({
    tenantId: "provider-a",
    caseId: "case-replay",
    expectedVersion: 2,
    event: assigned.event,
  });

  const stored = await repo.load("provider-a", "case-replay");
  assert.ok(stored);
  assert.deepEqual(replayCase(stored.events), stored.aggregate);
  assert.equal(stored.aggregate.tenantId, "provider-a");
});


test("same Signal retry converges to the original Case", async () => {
  const repo = new InMemoryCaseRepository();

  const first = createCase({
    id: "case-first",
    tenantId: "provider-a",
    sourceAdapter: "line-checkin",
    sourceSignalId: "signal-retry-001",
    priority: "normal",
    subjectId: "subject-001",
    sourceType: "non_response",
    createdAt: at(0),
  });
  const retry = createCase({
    id: "case-retry-proposal",
    tenantId: "provider-a",
    sourceAdapter: "line-checkin",
    sourceSignalId: "signal-retry-001",
    priority: "normal",
    subjectId: "subject-001",
    sourceType: "non_response",
    createdAt: at(1),
  });

  const firstResult = await repo.create(first.event);
  const retryResult = await repo.create(retry.event);

  assert.equal(firstResult.created, true);
  assert.equal(retryResult.created, false);
  assert.equal(retryResult.aggregate.id, "case-first");
  assert.equal(retryResult.event.data.caseId, "case-first");
  assert.equal(
    await repo.load("provider-a", "case-retry-proposal"),
    null,
  );
});

test("same source signal id from different adapters creates independent Cases", async () => {
  const repo = new InMemoryCaseRepository();

  const a = createCase({
    id: "case-adapter-a",
    tenantId: "provider-a",
    sourceAdapter: "line-checkin",
    sourceSignalId: "shared-id",
    priority: "normal",
    subjectId: "subject-001",
    sourceType: "non_response",
    createdAt: at(0),
  });
  const b = createCase({
    id: "case-adapter-b",
    tenantId: "provider-a",
    sourceAdapter: "external-sensor",
    sourceSignalId: "shared-id",
    priority: "normal",
    subjectId: "subject-001",
    sourceType: "non_response",
    createdAt: at(0),
  });

  const [resultA, resultB] = await Promise.all([
    repo.create(a.event),
    repo.create(b.event),
  ]);

  assert.equal(resultA.created, true);
  assert.equal(resultB.created, true);
  assert.equal(resultA.aggregate.id, "case-adapter-a");
  assert.equal(resultB.aggregate.id, "case-adapter-b");
});

test("Signal replay with changed lineage payload is rejected", async () => {
  const repo = new InMemoryCaseRepository();

  const first = createCase({
    id: "case-lineage",
    tenantId: "provider-a",
    sourceAdapter: "line-checkin",
    sourceSignalId: "signal-lineage",
    priority: "normal",
    subjectId: "subject-a",
    sourceType: "non_response",
    createdAt: at(0),
  });
  const mismatch = createCase({
    id: "case-lineage-retry",
    tenantId: "provider-a",
    sourceAdapter: "line-checkin",
    sourceSignalId: "signal-lineage",
    priority: "normal",
    subjectId: "subject-b",
    sourceType: "sos",
    createdAt: at(1),
  });

  await repo.create(first.event);

  await assert.rejects(
    repo.create(mismatch.event),
    SignalReplayMismatchError,
  );

  const stored = await repo.load("provider-a", "case-lineage");
  assert.equal(stored?.aggregate.subjectId, "subject-a");
  assert.equal(stored?.aggregate.sourceType, "non_response");
  assert.equal(stored?.events.length, 1);
});

test("parallel retries converge to exactly one Case", async () => {
  const repo = new InMemoryCaseRepository();

  const first = createCase({
    id: "case-parallel-a",
    tenantId: "provider-a",
    sourceAdapter: "line-checkin",
    sourceSignalId: "signal-parallel",
    priority: "normal",
    subjectId: "subject-parallel",
    sourceType: "non_response",
    createdAt: at(0),
  });
  const second = createCase({
    id: "case-parallel-b",
    tenantId: "provider-a",
    sourceAdapter: "line-checkin",
    sourceSignalId: "signal-parallel",
    priority: "normal",
    subjectId: "subject-parallel",
    sourceType: "non_response",
    createdAt: at(1),
  });

  const results = await Promise.all([
    repo.create(first.event),
    repo.create(second.event),
  ]);

  assert.deepEqual(
    results.map((result) => result.created).sort(),
    [false, true],
  );
  assert.equal(results[0]?.aggregate.id, results[1]?.aggregate.id);

  const winningId = results[0]!.aggregate.id;
  const losingId =
    winningId === "case-parallel-a"
      ? "case-parallel-b"
      : "case-parallel-a";

  assert.ok(await repo.load("provider-a", winningId));
  assert.equal(await repo.load("provider-a", losingId), null);
});
