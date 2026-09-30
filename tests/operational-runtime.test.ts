import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  OperationalCareOpsRuntime,
  type CareOpsOperationalLogRecord,
  type CareOpsMetricLabels,
} from "../src/index.ts";

function request(
  path: string,
  init: RequestInit = {},
): Request {
  return new Request(
    "https://care.example.test" + path,
    init,
  );
}

test("healthz is body-safe, no-store, and bypasses application handler", async () => {
  let handlerCalls = 0;
  const logs: CareOpsOperationalLogRecord[] = [];

  const runtime =
    new OperationalCareOpsRuntime({
      handler: {
        async handle() {
          handlerCalls += 1;
          return new Response(
            "unexpected",
          );
        },
      },
      logger: {
        write(record) {
          logs.push(
            structuredClone(record),
          );
        },
      },
      now: () =>
        "2026-09-26T10:00:00.000Z",
      nowMs: (() => {
        let value = 100;
        return () => value += 5;
      })(),
    });

  const response =
    await runtime.handle(
      request("/healthz"),
    );

  assert.equal(response.status, 200);
  assert.deepEqual(
    await response.json(),
    { status: "ok" },
  );
  assert.equal(
    response.headers.get(
      "cache-control",
    ),
    "no-store",
  );
  assert.equal(handlerCalls, 0);
  assert.equal(logs.length, 1);
  assert.equal(
    logs[0]?.routeClass,
    "health",
  );
});

test("readyz executes all checks but does not disclose check names or failure details", async () => {
  const seen: string[] = [];

  const runtime =
    new OperationalCareOpsRuntime({
      handler: {
        async handle() {
          throw new Error(
            "handler must not run",
          );
        },
      },
      readinessChecks: [
        {
          name: "database-secret-name",
          async check() {
            seen.push("db");
            return true;
          },
        },
        {
          name: "internal-provider-name",
          async check() {
            seen.push("provider");
            throw new Error(
              "private readiness detail",
            );
          },
        },
      ],
      nowMs: (() => {
        let value = 200;
        return () => value += 7;
      })(),
    });

  const response =
    await runtime.handle(
      request("/readyz"),
    );

  assert.equal(response.status, 503);
  const text = await response.text();

  assert.equal(
    text,
    JSON.stringify({
      status: "not_ready",
    }),
  );
  assert.deepEqual(
    seen,
    ["db", "provider"],
  );

  for (const forbidden of [
    "database-secret-name",
    "internal-provider-name",
    "private readiness detail",
  ]) {
    assert.equal(
      text.includes(forbidden),
      false,
    );
  }
});

test("request observability logs only generic route metadata and no identifiers or authorization values", async () => {
  const logs: CareOpsOperationalLogRecord[] = [];
  const increments: Array<{
    name: string;
    labels: CareOpsMetricLabels;
  }> = [];
  const observations: Array<{
    name: string;
    value: number;
    labels: CareOpsMetricLabels;
  }> = [];

  const runtime =
    new OperationalCareOpsRuntime({
      handler: {
        async handle() {
          return new Response(
            JSON.stringify({ ok: true }),
            {
              status: 200,
              headers: {
                "x-request-id":
                  "req-safe-001",
              },
            },
          );
        },
      },
      logger: {
        write(record) {
          logs.push(
            structuredClone(record),
          );
        },
      },
      metrics: {
        increment(name, labels) {
          increments.push({
            name,
            labels: {
              ...labels,
            },
          });
        },
        observe(
          name,
          value,
          labels,
        ) {
          observations.push({
            name,
            value,
            labels: {
              ...labels,
            },
          });
        },
      },
      now: () =>
        "2026-09-26T10:01:00.000Z",
      nowMs: (() => {
        let value = 500;
        return () => value += 11;
      })(),
    });

  const response =
    await runtime.handle(
      request(
        "/api/care-ops/tenants/provider-secret/cases/case-secret?subject=resident-secret",
        {
          method: "GET",
          headers: {
            authorization:
              "Bearer token-secret",
          },
        },
      ),
    );

  assert.equal(response.status, 200);
  assert.equal(logs.length, 1);

  const serialized =
    JSON.stringify({
      logs,
      increments,
      observations,
    });

  for (const forbidden of [
    "provider-secret",
    "case-secret",
    "resident-secret",
    "token-secret",
    "authorization",
    "subject",
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `${forbidden} must not reach default observability output`,
    );
  }

  assert.equal(
    logs[0]?.requestId,
    "req-safe-001",
  );
  assert.equal(
    logs[0]?.routeClass,
    "care_ops",
  );
  assert.equal(
    increments[0]?.name,
    "care_ops_http_requests_total",
  );
  assert.equal(
    observations[0]?.name,
    "care_ops_http_request_duration_ms",
  );
  assert.equal(
    increments[0]?.labels.statusClass,
    "2xx",
  );
});

test("handler exception becomes stable 500 without exposing exception details", async () => {
  const logs: CareOpsOperationalLogRecord[] = [];

  const runtime =
    new OperationalCareOpsRuntime({
      handler: {
        async handle() {
          throw new Error(
            "database password super-secret",
          );
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
        () => "ops-request-500",
      nowMs: (() => {
        let value = 700;
        return () => value += 3;
      })(),
    });

  const response =
    await runtime.handle(
      request("/api/care-ops/test"),
    );

  assert.equal(response.status, 500);
  assert.equal(
    response.headers.get(
      "x-request-id",
    ),
    "ops-request-500",
  );

  const body = await response.text();
  assert.deepEqual(
    JSON.parse(body),
    {
      error: {
        code: "INTERNAL_ERROR",
        message:
          "Internal server error",
        requestId:
          "ops-request-500",
      },
    },
  );

  assert.equal(
    body.includes("super-secret"),
    false,
  );
  assert.equal(
    JSON.stringify(logs).includes(
      "super-secret",
    ),
    false,
  );
});

test("logger and metrics failures never break request handling", async () => {
  const runtime =
    new OperationalCareOpsRuntime({
      handler: {
        async handle() {
          return new Response(
            "ok",
            {
              status: 200,
              headers: {
                "x-request-id":
                  "req-observe-fail",
              },
            },
          );
        },
      },
      logger: {
        write() {
          throw new Error(
            "logger unavailable",
          );
        },
      },
      metrics: {
        increment() {
          throw new Error(
            "metrics unavailable",
          );
        },
        observe() {
          throw new Error(
            "metrics unavailable",
          );
        },
      },
      nowMs: (() => {
        let value = 800;
        return () => value += 2;
      })(),
    });

  const response =
    await runtime.handle(
      request("/api/care-ops/test"),
    );

  assert.equal(response.status, 200);
  assert.equal(
    await response.text(),
    "ok",
  );
});

test("HEAD health/readiness responses are bodyless", async () => {
  const runtime =
    new OperationalCareOpsRuntime({
      handler: {
        async handle() {
          throw new Error(
            "handler must not run",
          );
        },
      },
      readinessChecks: [
        {
          name: "ready",
          check: () => true,
        },
      ],
    });

  for (const path of [
    "/healthz",
    "/readyz",
  ]) {
    const response =
      await runtime.handle(
        request(path, {
          method: "HEAD",
        }),
      );

    assert.equal(response.status, 200);
    assert.equal(
      await response.text(),
      "",
    );
  }
});

test("operations runtime source never reads body, authorization, query values, or sensitive route identifiers for logging", async () => {
  const source = await readFile(
    new URL(
      "../src/ops/operational-http-runtime.ts",
      import.meta.url,
    ),
    "utf8",
  );

  for (const forbidden of [
    "request.text(",
    "request.json(",
    'headers.get("authorization"',
    "searchParams",
    "tenantId",
    "caseId",
    "subjectId",
    "principalId",
    "actorId",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `${forbidden} must not be part of default operations logging`,
    );
  }
});
