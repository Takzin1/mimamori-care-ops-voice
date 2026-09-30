import assert from "node:assert/strict";
import test from "node:test";

import {
  ExactBrowserOriginPolicy,
  OperationalCareOpsRuntime,
  createOperationalSupabaseCareOpsRuntime,
  type CareOpsOperationalLogRecord,
  type CaseSlaPolicy,
  type OperationalSupabaseCareOpsRuntimeOptions,
} from "../src/index.ts";

function request(
  path = "/api/care-ops/tenants/provider-a/queue",
  init: RequestInit = {},
): Request {
  return new Request(
    "https://care.example.test" + path,
    init,
  );
}

test("denied admission returns 429 before application work and does not echo credentials or body", async () => {
  let handlerCalls = 0;
  let admissionCalls = 0;
  const logs: CareOpsOperationalLogRecord[] = [];

  const runtime =
    new OperationalCareOpsRuntime({
      handler: {
        async handle() {
          handlerCalls += 1;
          return new Response("unexpected");
        },
      },
      admission: {
        admit({ method, routeClass }) {
          admissionCalls += 1;
          assert.equal(method, "POST");
          assert.equal(
            routeClass,
            "care_ops",
          );
          return {
            allowed: false,
            retryAfterSeconds: 30,
          };
        },
      },
      logger: {
        write(record) {
          logs.push(
            structuredClone(record),
          );
        },
      },
      requestIdFactory:
        () => "admission-denied-001",
    });

  const response =
    await runtime.handle(
      request(
        "/api/care-ops/tenants/provider-secret/cases/case-secret/commands",
        {
          method: "POST",
          headers: {
            authorization:
              "Bearer highly-sensitive-token",
            "content-type":
              "application/json",
          },
          body: JSON.stringify({
            resident:
              "highly-sensitive-resident",
          }),
        },
      ),
    );

  assert.equal(response.status, 429);
  assert.equal(
    response.headers.get(
      "retry-after",
    ),
    "30",
  );
  assert.equal(
    response.headers.get(
      "x-request-id",
    ),
    "admission-denied-001",
  );
  assert.equal(
    response.headers.get("vary"),
    "Authorization",
  );
  assert.equal(handlerCalls, 0);
  assert.equal(admissionCalls, 1);

  const body = await response.text();
  assert.deepEqual(
    JSON.parse(body),
    {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
        requestId:
          "admission-denied-001",
      },
    },
  );

  const observable =
    JSON.stringify({
      body,
      logs,
    });

  for (const forbidden of [
    "highly-sensitive-token",
    "highly-sensitive-resident",
    "provider-secret",
    "case-secret",
  ]) {
    assert.equal(
      observable.includes(forbidden),
      false,
    );
  }

  assert.equal(
    logs[0]?.status,
    429,
  );
  assert.equal(
    logs[0]?.routeClass,
    "care_ops",
  );
});

test("allowed admission reaches the existing handler unchanged", async () => {
  let handlerCalls = 0;
  let observedAuthorization: string | null =
    null;

  const runtime =
    new OperationalCareOpsRuntime({
      admission: {
        admit() {
          return { allowed: true };
        },
      },
      handler: {
        async handle(req) {
          handlerCalls += 1;
          observedAuthorization =
            req.headers.get(
              "authorization",
            );
          return new Response(
            JSON.stringify({
              ok: true,
            }),
            {
              status: 200,
              headers: {
                "x-request-id":
                  "handler-request-001",
              },
            },
          );
        },
      },
    });

  const response =
    await runtime.handle(
      request(
        undefined,
        {
          headers: {
            authorization:
              "Bearer user-token",
          },
        },
      ),
    );

  assert.equal(response.status, 200);
  assert.equal(handlerCalls, 1);
  assert.equal(
    observedAuthorization,
    "Bearer user-token",
  );
});

test("admission backend failure fails closed as safe 503 before handler", async () => {
  let handlerCalls = 0;

  const runtime =
    new OperationalCareOpsRuntime({
      admission: {
        admit() {
          throw new Error(
            "redis-password private-backend-detail",
          );
        },
      },
      handler: {
        async handle() {
          handlerCalls += 1;
          return new Response("unexpected");
        },
      },
      requestIdFactory:
        () => "admission-error-001",
    });

  const response =
    await runtime.handle(
      request(),
    );

  assert.equal(response.status, 503);
  assert.equal(handlerCalls, 0);

  const body = await response.text();
  assert.deepEqual(
    JSON.parse(body),
    {
      error: {
        code:
          "ADMISSION_UNAVAILABLE",
        message:
          "Service temporarily unavailable",
        requestId:
          "admission-error-001",
      },
    },
  );
  assert.equal(
    body.includes("redis-password"),
    false,
  );
  assert.equal(
    body.includes(
      "private-backend-detail",
    ),
    false,
  );
});

test("malformed admission decisions fail closed and Retry-After is bounded", async () => {
  for (const badDecision of [
    null,
    {},
    { allowed: false, retryAfterSeconds: 0 },
    {
      allowed: false,
      retryAfterSeconds: 3601,
    },
    {
      allowed: false,
      retryAfterSeconds: 1.5,
    },
  ]) {
    const runtime =
      new OperationalCareOpsRuntime({
        admission: {
          admit: () =>
            badDecision as never,
        },
        handler: {
          async handle() {
            return new Response(
              "must not run",
            );
          },
        },
        requestIdFactory:
          () => "invalid-admission",
      });

    const response =
      await runtime.handle(
        request(),
      );

    assert.equal(
      response.status,
      503,
    );
    assert.equal(
      response.headers.get(
        "retry-after",
      ),
      null,
    );
  }

  const boundary =
    new OperationalCareOpsRuntime({
      admission: {
        admit: () => ({
          allowed: false,
          retryAfterSeconds: 3600,
        }),
      },
      handler: {
        async handle() {
          return new Response(
            "must not run",
          );
        },
      },
    });

  const response =
    await boundary.handle(
      request(),
    );

  assert.equal(response.status, 429);
  assert.equal(
    response.headers.get(
      "retry-after",
    ),
    "3600",
  );
});

test("GET and HEAD health/readiness probes bypass admission", async () => {
  let admissionCalls = 0;

  const runtime =
    new OperationalCareOpsRuntime({
      admission: {
        admit() {
          admissionCalls += 1;
          return {
            allowed: false,
          };
        },
      },
      handler: {
        async handle() {
          throw new Error(
            "handler must not run",
          );
        },
      },
      readinessChecks: [
        {
          name: "synthetic",
          check: () => true,
        },
      ],
    });

  for (const path of [
    "/healthz",
    "/readyz",
  ]) {
    for (const method of [
      "GET",
      "HEAD",
    ]) {
      const response =
        await runtime.handle(
          request(path, {
            method,
          }),
        );

      assert.equal(
        response.status,
        200,
      );
    }
  }

  assert.equal(admissionCalls, 0);
});

const productionOriginPolicy =
  new ExactBrowserOriginPolicy([
    "https://console.example.test",
  ]);

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

test("operational Supabase composition rejects missing admission controller", () => {
  const withoutAdmission = {
    originPolicy:
      productionOriginPolicy,
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
    },
  } as unknown as
    OperationalSupabaseCareOpsRuntimeOptions;

  assert.throws(
    () =>
      createOperationalSupabaseCareOpsRuntime(
        withoutAdmission,
      ),
    /request admission controller is required/,
  );
});

test("operational Supabase admission denial prevents Auth/PostgREST fetch", async () => {
  let fetchCalls = 0;
  let admissionCalls = 0;

  const app =
    createOperationalSupabaseCareOpsRuntime({
      originPolicy:
        productionOriginPolicy,
      admission: {
        admit() {
          admissionCalls += 1;
          return {
            allowed: false,
            retryAfterSeconds: 5,
          };
        },
      },
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
            "trusted dependency must not be called",
          );
        },
      },
      operations: {
        requestIdFactory:
          () => "production-admission-deny",
      },
    });

  const response =
    await app.handle(
      request(),
    );

  assert.equal(response.status, 429);
  assert.equal(admissionCalls, 1);
  assert.equal(fetchCalls, 0);
});
