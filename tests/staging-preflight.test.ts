import assert from "node:assert/strict";
import test from "node:test";

import {
  runStagingPreflight,
} from "../src/ops/staging-preflight.ts";

function json(
  body: unknown,
  status: number,
  headers: HeadersInit = {},
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
        ...headers,
      },
    },
  );
}

function happyFetch(
  seen: Request[],
): typeof fetch {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const request =
      input instanceof Request
        ? input
        : new Request(input, init);
    seen.push(request);

    const url = new URL(request.url);
    const origin =
      request.headers.get("origin");

    if (url.pathname === "/healthz") {
      return json({ status: "ok" }, 200);
    }

    if (url.pathname === "/readyz") {
      return json(
        { status: "ready" },
        200,
      );
    }

    if (
      origin ===
      "https://preflight.invalid"
    ) {
      return json(
        {
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message:
              "Browser origin is not allowed",
            requestId: "safe-request-id",
          },
        },
        403,
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin":
            "https://console.example.test",
          "access-control-allow-methods":
            "POST",
          "access-control-allow-headers":
            "Authorization, Content-Type",
          vary:
            "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
        },
      });
    }

    return json(
      {
        error: {
          code:
            "AUTHENTICATION_REQUIRED",
          message:
            "Authentication required",
          requestId: "safe-request-id",
        },
      },
      401,
      {
        "access-control-allow-origin":
          "https://console.example.test",
      },
    );
  };
}

test("staging preflight verifies safe public boundaries without credentials", async () => {
  const seen: Request[] = [];

  const report =
    await runStagingPreflight({
      baseUrl:
        "https://api.example.test",
      consoleOrigin:
        "https://console.example.test",
      fetchImpl: happyFetch(seen),
      now: () =>
        "2026-09-27T00:00:00.000Z",
    });

  assert.equal(report.passed, true);
  assert.equal(
    report.target,
    "https://api.example.test",
  );
  assert.equal(
    report.consoleOrigin,
    "https://console.example.test",
  );
  assert.equal(
    report.checkedAt,
    "2026-09-27T00:00:00.000Z",
  );
  assert.deepEqual(
    report.checks.map(
      (item) => [
        item.name,
        item.passed,
        item.status,
      ],
    ),
    [
      ["health", true, 200],
      ["readiness", true, 200],
      [
        "unexpected_origin_rejected",
        true,
        403,
      ],
      ["cors_preflight", true, 204],
      [
        "unauthenticated_browser_rejected",
        true,
        401,
      ],
    ],
  );

  assert.equal(seen.length, 5);

  for (const request of seen) {
    assert.equal(
      request.headers.has(
        "authorization",
      ),
      false,
    );
    assert.equal(
      request.headers.has("cookie"),
      false,
    );
  }

  assert.equal(
    JSON.stringify(report).includes(
      "Bearer ",
    ),
    false,
  );
});

test("staging preflight fails closed when readiness is not ready", async () => {
  const seen: Request[] = [];
  const baseFetch = happyFetch(seen);

  const fetchImpl: typeof fetch =
    async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(input, init);

      if (
        new URL(request.url).pathname ===
        "/readyz"
      ) {
        seen.push(request);
        return json(
          { status: "not_ready" },
          503,
        );
      }

      return baseFetch(input, init);
    };

  const report =
    await runStagingPreflight({
      baseUrl:
        "https://api.example.test",
      consoleOrigin:
        "https://console.example.test",
      fetchImpl,
    });

  assert.equal(report.passed, false);

  const readiness =
    report.checks.find(
      (item) =>
        item.name === "readiness",
    );

  assert.deepEqual(
    {
      passed: readiness?.passed,
      status: readiness?.status,
    },
    {
      passed: false,
      status: 503,
    },
  );
});

test("staging preflight detects permissive unexpected-origin behavior", async () => {
  const seen: Request[] = [];
  const baseFetch = happyFetch(seen);

  const fetchImpl: typeof fetch =
    async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(input, init);

      if (
        request.headers.get("origin") ===
        "https://preflight.invalid"
      ) {
        seen.push(request);
        return json(
          {
            error: {
              code:
                "AUTHENTICATION_REQUIRED",
              message:
                "Authentication required",
              requestId:
                "safe-request-id",
            },
          },
          401,
          {
            "access-control-allow-origin":
              "*",
          },
        );
      }

      return baseFetch(input, init);
    };

  const report =
    await runStagingPreflight({
      baseUrl:
        "https://api.example.test",
      consoleOrigin:
        "https://console.example.test",
      fetchImpl,
    });

  const origin =
    report.checks.find(
      (item) =>
        item.name ===
        "unexpected_origin_rejected",
    );

  assert.equal(report.passed, false);
  assert.equal(origin?.passed, false);
  assert.equal(origin?.status, 401);
});

test("staging preflight rejects credential-bearing or non-origin configuration", async () => {
  await assert.rejects(
    () =>
      runStagingPreflight({
        baseUrl:
          "https://user:pass@api.example.test",
        consoleOrigin:
          "https://console.example.test",
        fetchImpl: happyFetch([]),
      }),
    /must not contain credentials/,
  );

  await assert.rejects(
    () =>
      runStagingPreflight({
        baseUrl:
          "https://api.example.test",
        consoleOrigin:
          "https://console.example.test/path",
        fetchImpl: happyFetch([]),
      }),
    /must be an origin only/,
  );
});
