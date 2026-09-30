import assert from "node:assert/strict";
import test from "node:test";

import {
  CareOpsClientConfigurationError,
  CareOpsHttpClient,
  CareOpsHttpClientError,
  CareOpsHttpProtocolError,
} from "../src/index.ts";

interface Call {
  url: URL;
  init: RequestInit;
  headers: Headers;
}

function jsonResponse(
  value: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(value),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
      },
    },
  );
}

test("browser client requests a fresh access token for every API operation", async () => {
  const calls: Call[] = [];
  let tokenCounter = 0;

  const client = new CareOpsHttpClient({
    baseUrl: "https://care.example.test",
    accessTokenProvider: () =>
      "token-" + String(++tokenCounter),
    fetchImpl: async (input, init = {}) => {
      const url = new URL(input.toString());
      const headers = new Headers(init.headers);

      calls.push({
        url,
        init,
        headers,
      });

      if (url.pathname.endsWith("/queue")) {
        return jsonResponse({
          tenantId: "provider-a",
          evaluatedAt:
            "2026-09-26T02:00:00.000Z",
          items: [],
          summary: {
            total: 0,
            breached: 0,
            unacknowledged: 0,
            unassigned: 0,
            handoffPending: 0,
            byPriority: {
              critical: 0,
              high: 0,
              normal: 0,
              low: 0,
            },
          },
        });
      }

      if (url.pathname.endsWith("/metrics")) {
        return jsonResponse({
          timeToAcknowledgeMs: null,
          timeToAssignmentMs: null,
          timeToFirstActionMs: null,
          timeToCompletionMs: null,
          handoffCount: 0,
          reopenCount: 0,
        });
      }

      if (url.pathname.endsWith("/commands")) {
        return jsonResponse({
          aggregate: {
            id: "case-a",
            version: 2,
          },
          event: {
            type: "acknowledged",
          },
        });
      }

      return jsonResponse({
        aggregate: {
          id: "case-a",
          version: 1,
        },
        events: [],
      });
    },
  });

  await client.queue("provider-a");
  await client.getCase(
    "provider-a",
    "case-a",
  );
  await client.metrics(
    "provider-a",
    "case-a",
  );

  const maliciousCommand = {
    type: "acknowledge",
    actorId: "forged-actor",
  } as any;

  await client.execute(
    "provider-a",
    "case-a",
    1,
    maliciousCommand,
  );

  assert.equal(tokenCounter, 4);
  assert.equal(calls.length, 4);

  assert.deepEqual(
    calls.map((call) =>
      call.headers.get("authorization"),
    ),
    [
      "Bearer token-1",
      "Bearer token-2",
      "Bearer token-3",
      "Bearer token-4",
    ],
  );

  assert.deepEqual(
    calls.map((call) => call.url.pathname),
    [
      "/api/care-ops/tenants/provider-a/queue",
      "/api/care-ops/tenants/provider-a/cases/case-a",
      "/api/care-ops/tenants/provider-a/cases/case-a/metrics",
      "/api/care-ops/tenants/provider-a/cases/case-a/commands",
    ],
  );

  for (const call of calls) {
    assert.equal(
      call.init.credentials,
      "omit",
    );
    assert.equal(
      call.init.cache,
      "no-store",
    );
    assert.equal(
      call.init.redirect,
      "error",
    );
    assert.equal(
      call.init.referrerPolicy,
      "no-referrer",
    );
  }

  const commandCall = calls[3]!;
  assert.equal(
    commandCall.headers.get(
      "content-type",
    ),
    "application/json",
  );

  const sent = JSON.parse(
    String(commandCall.init.body),
  );

  assert.deepEqual(sent, {
    expectedVersion: 1,
    command: {
      type: "acknowledge",
    },
  });

  assert.equal(
    JSON.stringify(sent).includes(
      "forged-actor",
    ),
    false,
  );
  assert.equal(
    JSON.stringify(sent).includes(
      "principalId",
    ),
    false,
  );
});

test("browser client maps safe API error envelope without token leakage", async () => {
  const client = new CareOpsHttpClient({
    baseUrl: "https://care.example.test",
    accessTokenProvider: () =>
      "highly-sensitive-user-token",
    fetchImpl: async () =>
      jsonResponse(
        {
          error: {
            code: "CASE_VERSION_CONFLICT",
            message:
              "Case version conflict",
            requestId: "request-123",
            details: {
              expectedVersion: 1,
              actualVersion: 2,
            },
          },
        },
        409,
      ),
  });

  await assert.rejects(
    client.execute(
      "provider-a",
      "case-a",
      1,
      {
        type: "acknowledge",
      },
    ),
    (error: unknown) => {
      assert.ok(
        error instanceof
          CareOpsHttpClientError,
      );
      assert.equal(error.status, 409);
      assert.equal(
        error.code,
        "CASE_VERSION_CONFLICT",
      );
      assert.equal(
        error.requestId,
        "request-123",
      );
      assert.deepEqual(
        error.details,
        {
          expectedVersion: 1,
          actualVersion: 2,
        },
      );
      assert.equal(
        String(error).includes(
          "highly-sensitive-user-token",
        ),
        false,
      );
      return true;
    },
  );
});

test("browser client fails closed on malformed API response", async () => {
  const nonJson = new CareOpsHttpClient({
    baseUrl: "https://care.example.test",
    accessTokenProvider: () =>
      "user-token",
    fetchImpl: async () =>
      new Response(
        "<html>proxy error</html>",
        {
          status: 502,
          headers: {
            "content-type": "text/html",
          },
        },
      ),
  });

  await assert.rejects(
    nonJson.queue("provider-a"),
    CareOpsHttpProtocolError,
  );

  const malformedError =
    new CareOpsHttpClient({
      baseUrl:
        "https://care.example.test",
      accessTokenProvider: () =>
        "user-token",
      fetchImpl: async () =>
        jsonResponse(
          {
            error: {
              rawDatabaseMessage:
                "secret internals",
            },
          },
          500,
        ),
    });

  await assert.rejects(
    malformedError.queue("provider-a"),
    CareOpsHttpProtocolError,
  );
});

test("browser client does not persist or serialize access tokens", async () => {
  let fetchCalls = 0;

  const client = new CareOpsHttpClient({
    baseUrl: "https://care.example.test",
    accessTokenProvider: () =>
      "ephemeral-user-token",
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({
        tenantId: "provider-a",
        evaluatedAt:
          "2026-09-26T02:00:00.000Z",
        items: [],
        summary: {
          total: 0,
          breached: 0,
          unacknowledged: 0,
          unassigned: 0,
          handoffPending: 0,
          byPriority: {
            critical: 0,
            high: 0,
            normal: 0,
            low: 0,
          },
        },
      });
    },
  });

  assert.deepEqual(
    Object.keys(client),
    [],
  );
  assert.equal(
    JSON.stringify(client),
    "{}",
  );
  assert.equal(
    JSON.stringify(client).includes(
      "ephemeral-user-token",
    ),
    false,
  );

  await client.queue("provider-a");
  assert.equal(fetchCalls, 1);
});

test("browser client rejects unsafe identifiers, malformed tokens and unsafe base URLs before fetch", async () => {
  let fetchCalls = 0;

  const client = new CareOpsHttpClient({
    baseUrl: "https://care.example.test",
    accessTokenProvider: () => " ",
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({});
    },
  });

  await assert.rejects(
    client.queue("provider-a"),
    CareOpsClientConfigurationError,
  );
  assert.equal(fetchCalls, 0);

  const validTokenClient =
    new CareOpsHttpClient({
      baseUrl:
        "https://care.example.test",
      accessTokenProvider: () =>
        "user-token",
      fetchImpl: async () => {
        fetchCalls += 1;
        return jsonResponse({});
      },
    });

  await assert.rejects(
    validTokenClient.queue(
      "provider/a",
    ),
    CareOpsClientConfigurationError,
  );
  assert.equal(fetchCalls, 0);

  assert.throws(
    () =>
      new CareOpsHttpClient({
        baseUrl:
          "https://care.example.test/subpath",
        accessTokenProvider: () =>
          "user-token",
      }),
    CareOpsClientConfigurationError,
  );

  assert.throws(
    () =>
      new CareOpsHttpClient({
        baseUrl:
          "https://user:pass@care.example.test",
        accessTokenProvider: () =>
          "user-token",
      }),
    CareOpsClientConfigurationError,
  );
});


test("browser client fetches operator and Case capability projections with fresh tokens", async () => {
  const paths: string[] = [];
  const auth: string[] = [];
  let token = 0;

  const client = new CareOpsHttpClient({
    baseUrl: "https://care.example.test",
    accessTokenProvider: () =>
      "cap-token-" + String(++token),
    fetchImpl: async (
      input,
      init = {},
    ) => {
      const url = new URL(
        input.toString(),
      );
      paths.push(url.pathname);
      auth.push(
        new Headers(init.headers)
          .get("authorization") ?? "",
      );

      if (
        url.pathname.endsWith(
          "/operator",
        )
      ) {
        return jsonResponse({
          tenantId: "provider-a",
          actorId: "dispatcher-a",
          roles: ["dispatcher"],
          queueVisibility: "tenant",
        });
      }

      return jsonResponse({
        tenantId: "provider-a",
        caseId: "case-a",
        version: 1,
        status: "NEW",
        operator: {
          tenantId: "provider-a",
          actorId: "dispatcher-a",
          roles: ["dispatcher"],
          queueVisibility: "tenant",
        },
        commands: [
          {
            type: "acknowledge",
            requires: [],
          },
        ],
      });
    },
  });

  const operator =
    await client.operatorContext(
      "provider-a",
    );
  const capabilities =
    await client.caseCapabilities(
      "provider-a",
      "case-a",
    );

  assert.equal(
    operator.actorId,
    "dispatcher-a",
  );
  assert.equal(
    capabilities.commands[0]?.type,
    "acknowledge",
  );

  assert.deepEqual(paths, [
    "/api/care-ops/tenants/provider-a/operator",
    "/api/care-ops/tenants/provider-a/cases/case-a/capabilities",
  ]);
  assert.deepEqual(auth, [
    "Bearer cap-token-1",
    "Bearer cap-token-2",
  ]);
});
