import assert from "node:assert/strict";
import test from "node:test";

import {
  ExactBrowserOriginPolicy,
  createOperationalSupabaseCareOpsRuntime,
  type CaseSlaPolicy,
} from "../src/index.ts";

const minute = 60_000;

const allowAdmission = {
  admit: () => ({
    allowed: true as const,
  }),
};

const originPolicy =
  new ExactBrowserOriginPolicy([
    "https://console.example.test",
  ]);

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
    handoffAcceptWithinMs: 5 * minute,
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

test("operational Supabase runtime serves health/readiness without touching Supabase", async () => {
  let fetchCalls = 0;

  const app =
    createOperationalSupabaseCareOpsRuntime({
      admission: allowAdmission,
      originPolicy,
      runtime: {
        supabaseUrl:
          "https://project.supabase.test",
        publishableKey:
          "publishable-key",
        serviceRoleKey:
          "service-secret",
        slaPolicies: {
          "provider-a": policy,
        },
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error(
            "Supabase must not be called",
          );
        },
      },
      operations: {
        readinessChecks: [
          {
            name: "synthetic-ready",
            check: () => true,
          },
        ],
      },
    });

  const health = await app.handle(
    new Request(
      "https://care.example.test/healthz",
    ),
  );
  const ready = await app.handle(
    new Request(
      "https://care.example.test/readyz",
    ),
  );

  assert.equal(health.status, 200);
  assert.equal(ready.status, 200);
  assert.deepEqual(
    await health.json(),
    { status: "ok" },
  );
  assert.deepEqual(
    await ready.json(),
    { status: "ready" },
  );
  assert.equal(fetchCalls, 0);
});

test("operational Supabase runtime public object does not expose runtime credentials", () => {
  const app =
    createOperationalSupabaseCareOpsRuntime({
      admission: allowAdmission,
      originPolicy,
      runtime: {
        supabaseUrl:
          "https://project.supabase.test",
        publishableKey:
          "publishable-key",
        serviceRoleKey:
          "service-secret",
        slaPolicies: {
          "provider-a": policy,
        },
        fetchImpl: async () =>
          new Response(null, {
            status: 500,
          }),
      },
    });

  assert.deepEqual(
    Object.keys(app),
    [],
  );
  assert.equal(
    JSON.stringify(app),
    "{}",
  );
  assert.equal(
    JSON.stringify(app).includes(
      "service-secret",
    ),
    false,
  );
});
