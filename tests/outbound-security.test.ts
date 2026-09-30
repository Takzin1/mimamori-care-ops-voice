import assert from "node:assert/strict";
import test from "node:test";

import {
  PostgrestCaseRepository,
  PostgrestOutboxStore,
  PostgrestTenantMembershipDirectory,
  SupabaseAuthAuthenticator,
  createSupabaseCareOpsRuntime,
  outboundTimeoutMs,
  type CaseSlaPolicy,
} from "../src/index.ts";

function jsonResponse(
  value: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(value),
    {
      status,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}

test("outbound timeout is bounded and defaults to ten seconds", () => {
  assert.equal(
    outboundTimeoutMs(undefined),
    10_000,
  );
  assert.equal(
    outboundTimeoutMs(2500),
    2500,
  );

  for (const invalid of [
    0,
    -1,
    60_001,
    1.5,
  ]) {
    assert.throws(
      () => outboundTimeoutMs(invalid),
      /outbound request timeout/,
    );
  }
});

test("Supabase Auth request carries an AbortSignal", async () => {
  let signal: AbortSignal | null = null;

  const auth =
    new SupabaseAuthAuthenticator({
      baseUrl:
        "https://example.supabase.co",
      publishableKey:
        "publishable-key",
      requestTimeoutMs: 5000,
      fetchImpl: async (
        _input,
        init = {},
      ) => {
        signal = init.signal ?? null;
        return jsonResponse({
          id: "principal-a",
        });
      },
    });

  await auth.authenticate("token");

  assert.ok(
    signal instanceof AbortSignal,
  );
});

test("membership request carries an AbortSignal", async () => {
  let signal: AbortSignal | null = null;

  const directory =
    new PostgrestTenantMembershipDirectory({
      baseUrl:
        "https://example.supabase.co",
      serviceRoleKey:
        "service-secret",
      requestTimeoutMs: 5000,
      fetchImpl: async (
        _input,
        init = {},
      ) => {
        signal = init.signal ?? null;
        return jsonResponse([]);
      },
    });

  assert.equal(
    await directory.findByPrincipal(
      "provider-a",
      "principal-a",
    ),
    null,
  );

  assert.ok(
    signal instanceof AbortSignal,
  );
});

test("Case Store requests carry AbortSignals", async () => {
  const signals: AbortSignal[] = [];

  const repository =
    new PostgrestCaseRepository({
      baseUrl:
        "https://example.supabase.co",
      serviceRoleKey:
        "service-secret",
      requestTimeoutMs: 5000,
      fetchImpl: async (
        _input,
        init = {},
      ) => {
        if (init.signal) {
          signals.push(init.signal);
        }
        return jsonResponse([]);
      },
    });

  assert.equal(
    await repository.load(
      "provider-a",
      "case-a",
    ),
    null,
  );

  assert.equal(signals.length, 2);
  assert.ok(
    signals.every(
      (signal) =>
        signal instanceof AbortSignal,
    ),
  );
});

test("Outbox request carries an AbortSignal", async () => {
  let signal: AbortSignal | null = null;

  const store =
    new PostgrestOutboxStore({
      baseUrl:
        "https://example.supabase.co",
      serviceRoleKey:
        "service-secret",
      requestTimeoutMs: 5000,
      fetchImpl: async (
        _input,
        init = {},
      ) => {
        signal = init.signal ?? null;
        return jsonResponse({
          ok: true,
          created: true,
          id: 1,
        });
      },
    });

  await store.enqueue({
    tenantId: "provider-a",
    topic: "synthetic",
    deliveryKey: "synthetic:1",
    payload: {},
  });

  assert.ok(
    signal instanceof AbortSignal,
  );
});

test("server runtime rejects an invalid outbound timeout before handling traffic", () => {
  const minute = 60_000;
  const policy: CaseSlaPolicy = {
    critical: {
      acknowledgeWithinMs: minute,
      assignWithinMs: minute,
      firstActionWithinMs: minute,
      handoffAcceptWithinMs: minute,
      completeWithinMs: minute,
    },
    high: {
      acknowledgeWithinMs: minute,
      assignWithinMs: minute,
      firstActionWithinMs: minute,
      handoffAcceptWithinMs: minute,
      completeWithinMs: minute,
    },
    normal: {
      acknowledgeWithinMs: minute,
      assignWithinMs: minute,
      firstActionWithinMs: minute,
      handoffAcceptWithinMs: minute,
      completeWithinMs: minute,
    },
    low: {
      acknowledgeWithinMs: minute,
      assignWithinMs: minute,
      firstActionWithinMs: minute,
      handoffAcceptWithinMs: minute,
      completeWithinMs: minute,
    },
  };

  assert.throws(
    () =>
      createSupabaseCareOpsRuntime({
        supabaseUrl:
          "https://example.supabase.co",
        publishableKey:
          "publishable-key",
        serviceRoleKey:
          "service-secret",
        slaPolicies: {
          "provider-a": policy,
        },
        outboundTimeoutMs: 0,
      }),
    /outbound request timeout/,
  );
});
