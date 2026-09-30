import assert from "node:assert/strict";
import test from "node:test";

import {
  CaseStoreCorruptionError,
  CaseStoreTransportError,
  PostgrestOutboxMonitor,
} from "../src/index.ts";

const validSnapshot = {
  tenantId: "provider-a",
  evaluatedAt:
    "2026-09-27T00:00:00.000Z",
  counts: {
    pending: 2,
    processing: 1,
    failed: 3,
    deadLetter: 1,
    delivered: null,
  },
  oldestActionableAt:
    "2026-09-26T23:00:00.000Z",
  oldestDeadLetterAt:
    "2026-09-26T22:00:00.000Z",
  maxAttemptCount: 8,
};

test("PostgREST outbox monitor requests only the aggregate RPC with timeout signal", async () => {
  let seenBody: unknown;
  let seenSignal:
    AbortSignal | null = null;

  const monitor =
    new PostgrestOutboxMonitor({
      baseUrl:
        "https://project.supabase.test",
      serviceRoleKey:
        "service-secret",
      requestTimeoutMs: 25,
      fetchImpl: async (
        input,
        init = {},
      ) => {
        const url =
          new URL(input.toString());
        assert.equal(
          url.pathname,
          "/rest/v1/rpc/get_care_outbox_health",
        );

        const headers =
          new Headers(init.headers);
        assert.equal(
          headers.get("apikey"),
          "service-secret",
        );

        seenSignal =
          init.signal ?? null;
        seenBody =
          JSON.parse(
            String(init.body),
          );

        return new Response(
          JSON.stringify(
            validSnapshot,
          ),
          { status: 200 },
        );
      },
    });

  const snapshot =
    await monitor.snapshot(
      "provider-a",
    );

  assert.deepEqual(
    seenBody,
    {
      p_tenant_id: "provider-a",
      p_include_delivered: false,
    },
  );
  assert.ok(
    seenSignal instanceof AbortSignal,
  );
  assert.deepEqual(
    snapshot,
    validSnapshot,
  );

  const serialized =
    JSON.stringify(snapshot);

  for (const forbidden of [
    "payload",
    "deliveryKey",
    "lastError",
    "caseId",
    "subjectId",
    "service-secret",
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
    );
  }
});

test("outbox monitor can request delivered aggregate explicitly", async () => {
  const monitor =
    new PostgrestOutboxMonitor({
      baseUrl:
        "https://project.supabase.test",
      serviceRoleKey:
        "service-secret",
      fetchImpl: async (
        _input,
        init = {},
      ) => {
        const body =
          JSON.parse(
            String(init.body),
          );
        assert.equal(
          body.p_include_delivered,
          true,
        );

        return new Response(
          JSON.stringify({
            ...validSnapshot,
            counts: {
              ...validSnapshot.counts,
              delivered: 9,
            },
          }),
          { status: 200 },
        );
      },
    });

  const snapshot =
    await monitor.snapshot(
      "provider-a",
      {
        includeDelivered: true,
      },
    );

  assert.equal(
    snapshot.counts.delivered,
    9,
  );
});

test("outbox monitor fails closed on tenant mismatch and corrupt aggregates", async () => {
  for (const responseBody of [
    {
      ...validSnapshot,
      tenantId: "provider-b",
    },
    {
      ...validSnapshot,
      counts: {
        ...validSnapshot.counts,
        deadLetter: -1,
      },
    },
    {
      ...validSnapshot,
      evaluatedAt: "not-a-time",
    },
  ]) {
    const monitor =
      new PostgrestOutboxMonitor({
        baseUrl:
          "https://project.supabase.test",
        serviceRoleKey:
          "service-secret",
        fetchImpl: async () =>
          new Response(
            JSON.stringify(
              responseBody,
            ),
            { status: 200 },
          ),
      });

    await assert.rejects(
      monitor.snapshot(
        "provider-a",
      ),
      CaseStoreCorruptionError,
    );
  }
});

test("outbox monitor maps transport failures without leaking credentials", async () => {
  const monitor =
    new PostgrestOutboxMonitor({
      baseUrl:
        "https://project.supabase.test",
      serviceRoleKey:
        "service-secret",
      fetchImpl: async () => {
        throw new Error(
          "network with service-secret",
        );
      },
    });

  await assert.rejects(
    monitor.snapshot("provider-a"),
    (error: unknown) => {
      assert.ok(
        error instanceof
          CaseStoreTransportError,
      );
      assert.equal(
        error.message.includes(
          "service-secret",
        ),
        false,
      );
      return true;
    },
  );
});
