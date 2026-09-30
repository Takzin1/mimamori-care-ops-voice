import assert from "node:assert/strict";
import test from "node:test";

import {
  OutboxDeliveryKeyConflictError,
  OutboxWorker,
  PostgrestOutboxStore,
} from "../src/index.ts";

function message(overrides = {}) {
  return {
    id: 1,
    tenantId: "provider-a",
    topic: "case.event.committed",
    deliveryKey: "case-event:case-1:1",
    payload: { caseId: "case-1" },
    status: "processing",
    attemptCount: 1,
    maxAttempts: 8,
    availableAt: "2026-09-25T07:00:00.000Z",
    claimedAt: "2026-09-25T07:00:00.000Z",
    leaseUntil: "2026-09-25T07:01:00.000Z",
    workerId: "worker-a",
    ...overrides,
  };
}

test("OutboxWorker delivers, acknowledges, and preserves delivery key", async () => {
  const delivered = [];
  const completed = [];
  const failed = [];

  const store = {
    enqueue: async () => ({ created: true, id: 1 }),
    claim: async () => [
      message(),
      message({
        id: 2,
        topic: "unknown.topic",
        deliveryKey: "unknown:2",
      }),
    ],
    complete: async (input) => {
      completed.push(input);
      return true;
    },
    fail: async (input) => {
      failed.push(input);
      return { ok: true, status: "failed" };
    },
  };

  const worker = new OutboxWorker(
    store,
    [{
      topic: "case.event.committed",
      deliver: async (item) => {
        delivered.push(item.deliveryKey);
      },
    }],
    {
      retryDelayMs: 30_000,
      now: () => "2026-09-25T07:00:00.000Z",
    },
  );

  const result = await worker.runOnce({
    tenantId: "provider-a",
    workerId: "worker-a",
  });

  assert.deepEqual(delivered, [
    "case-event:case-1:1",
  ]);
  assert.equal(completed.length, 1);
  assert.equal(failed.length, 1);
  assert.equal(
    failed[0].retryAt,
    "2026-09-25T07:00:30.000Z",
  );
  assert.deepEqual(result, {
    claimed: 2,
    delivered: 1,
    failed: 1,
    unconfirmed: 0,
  });
});

test("OutboxWorker reports delivered-but-unconfirmed separately", async () => {
  let deliveryCount = 0;

  const store = {
    enqueue: async () => ({ created: true, id: 1 }),
    claim: async () => [message()],
    complete: async () => false,
    fail: async () => ({ ok: false, status: null }),
  };

  const worker = new OutboxWorker(
    store,
    [{
      topic: "case.event.committed",
      deliver: async () => {
        deliveryCount += 1;
      },
    }],
  );

  const result = await worker.runOnce({
    tenantId: "provider-a",
    workerId: "worker-a",
  });

  assert.equal(deliveryCount, 1);
  assert.deepEqual(result, {
    claimed: 1,
    delivered: 0,
    failed: 0,
    unconfirmed: 1,
  });
});

test("OutboxWorker records handler failure for retry", async () => {
  const failures = [];

  const store = {
    enqueue: async () => ({ created: true, id: 1 }),
    claim: async () => [message()],
    complete: async () => true,
    fail: async (input) => {
      failures.push(input);
      return { ok: true, status: "failed" };
    },
  };

  const worker = new OutboxWorker(
    store,
    [{
      topic: "case.event.committed",
      deliver: async () => {
        throw new Error("synthetic provider failure");
      },
    }],
    {
      retryDelayMs: 60_000,
      now: () => "2026-09-25T07:00:00.000Z",
    },
  );

  const result = await worker.runOnce({
    tenantId: "provider-a",
    workerId: "worker-a",
  });

  assert.equal(
    failures[0].error,
    "synthetic provider failure",
  );
  assert.equal(
    failures[0].retryAt,
    "2026-09-25T07:01:00.000Z",
  );
  assert.equal(result.failed, 1);
});

test("PostgREST outbox store maps enqueue, claim, complete and fail", async () => {
  const calls = [];

  const store = new PostgrestOutboxStore({
    baseUrl: "https://example.supabase.co",
    serviceRoleKey: "service-secret",
    fetchImpl: async (input, init = {}) => {
      const url = new URL(input.toString());
      const headers = new Headers(init.headers);
      assert.equal(headers.get("apikey"), "service-secret");
      calls.push(url.pathname);

      if (url.pathname.endsWith("/enqueue_care_outbox")) {
        return new Response(
          JSON.stringify({
            ok: true,
            created: true,
            id: 11,
          }),
          { status: 200 },
        );
      }

      if (url.pathname.endsWith("/claim_care_outbox")) {
        return new Response(
          JSON.stringify([
            message({
              id: 11,
              attemptCount: 2,
            }),
          ]),
          { status: 200 },
        );
      }

      if (url.pathname.endsWith("/complete_care_outbox")) {
        return new Response(
          JSON.stringify({
            ok: true,
            id: 11,
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          id: 11,
          status: "failed",
        }),
        { status: 200 },
      );
    },
  });

  const enqueued = await store.enqueue({
    tenantId: "provider-a",
    topic: "case.event.committed",
    deliveryKey: "case-event:case-1:1",
    payload: { caseId: "case-1" },
  });
  assert.deepEqual(enqueued, {
    created: true,
    id: 11,
  });

  const claimed = await store.claim({
    tenantId: "provider-a",
    workerId: "worker-a",
  });
  assert.equal(claimed[0].attemptCount, 2);

  assert.equal(
    await store.complete({
      tenantId: "provider-a",
      id: 11,
      workerId: "worker-a",
    }),
    true,
  );

  assert.deepEqual(
    await store.fail({
      tenantId: "provider-a",
      id: 11,
      workerId: "worker-a",
      error: "synthetic",
    }),
    {
      ok: true,
      status: "failed",
    },
  );

  assert.equal(calls.length, 4);
});

test("PostgREST outbox store maps delivery-key conflict", async () => {
  const store = new PostgrestOutboxStore({
    baseUrl: "https://example.supabase.co",
    serviceRoleKey: "service-secret",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: false,
          conflict: true,
          reason: "delivery_key_reuse",
          id: 11,
        }),
        { status: 200 },
      ),
  });

  await assert.rejects(
    store.enqueue({
      tenantId: "provider-a",
      topic: "sla.breach",
      deliveryKey: "breach:case-1:ack",
      payload: { stage: "acknowledge" },
    }),
    OutboxDeliveryKeyConflictError,
  );
});
