import assert from "node:assert/strict";
import test from "node:test";

import {
  createCase,
  createSupabaseCareOpsRuntime,
  type CaseSlaPolicy,
} from "../src/index.ts";

const minute = 60_000;

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

interface FetchCall {
  url: URL;
  method: string;
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
        "content-type": "application/json",
      },
    },
  );
}

function syntheticCase() {
  return createCase({
    id: "case-runtime",
    tenantId: "provider-a",
    subjectId: "subject-runtime",
    sourceType: "non_response",
    sourceAdapter: "runtime-test",
    sourceSignalId: "signal-runtime",
    priority: "high",
    createdAt: "2026-09-26T01:00:00.000Z",
  });
}

class FakeSupabaseBoundary {
  readonly calls: FetchCall[] = [];
  private readonly created = syntheticCase();

  fetch = async (
    input: string | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = new URL(input.toString());
    const headers = new Headers(init.headers);
    const method = init.method ?? "GET";

    this.calls.push({
      url,
      method,
      headers,
    });

    if (url.pathname === "/auth/v1/user") {
      if (
        headers.get("authorization") !==
        "Bearer user-token"
      ) {
        return jsonResponse(
          { message: "invalid JWT" },
          401,
        );
      }

      return jsonResponse({
        id: "principal-a",
        user_metadata: {
          roles: ["supervisor"],
        },
      });
    }

    if (
      url.pathname ===
      "/rest/v1/care_tenant_memberships"
    ) {
      return jsonResponse([
        {
          tenant_id: "provider-a",
          principal_id: "principal-a",
          actor_id: "dispatcher-a",
          roles: ["dispatcher"],
          active: true,
        },
      ]);
    }

    if (
      url.pathname ===
      "/rest/v1/care_cases"
    ) {
      return jsonResponse([
        {
          case_id:
            this.created.aggregate.id,
          snapshot:
            this.created.aggregate,
        },
      ]);
    }

    if (
      url.pathname ===
      "/rest/v1/care_case_events"
    ) {
      return jsonResponse([
        {
          case_id:
            this.created.aggregate.id,
          sequence:
            this.created.event.sequence,
          event:
            this.created.event,
        },
      ]);
    }

    return jsonResponse(
      { message: "unexpected path" },
      500,
    );
  };
}

function runtime(
  boundary: FakeSupabaseBoundary,
) {
  return createSupabaseCareOpsRuntime({
    supabaseUrl:
      "https://project.supabase.test",
    publishableKey: "publishable-key",
    serviceRoleKey: "service-secret",
    slaPolicies: {
      "provider-a": policy,
    },
    fetchImpl: boundary.fetch,
    clock: () =>
      "2026-09-26T01:05:00.000Z",
    requestIdFactory: () =>
      "runtime-request-1",
  });
}

test("Supabase runtime routes user bearer only to Auth and service role only to PostgREST", async () => {
  const boundary =
    new FakeSupabaseBoundary();
  const app = runtime(boundary);

  const response = await app.handle(
    new Request(
      "https://care.example.test/api/care-ops/tenants/provider-a/queue",
      {
        headers: {
          authorization:
            "Bearer user-token",
        },
      },
    ),
  );

  assert.equal(response.status, 200);
  const payload = await response.json() as any;

  assert.equal(payload.tenantId, "provider-a");
  assert.deepEqual(
    payload.items.map(
      (item: { caseId: string }) =>
        item.caseId,
    ),
    ["case-runtime"],
  );

  const authCalls = boundary.calls.filter(
    (call) =>
      call.url.pathname ===
      "/auth/v1/user",
  );
  const restCalls = boundary.calls.filter(
    (call) =>
      call.url.pathname.startsWith(
        "/rest/v1/",
      ),
  );

  assert.equal(authCalls.length, 1);
  assert.ok(restCalls.length >= 3);

  assert.equal(
    authCalls[0]?.headers.get("apikey"),
    "publishable-key",
  );
  assert.equal(
    authCalls[0]?.headers.get(
      "authorization",
    ),
    "Bearer user-token",
  );
  assert.equal(
    authCalls[0]?.headers
      .get("authorization")
      ?.includes("service-secret"),
    false,
  );

  for (const call of restCalls) {
    assert.equal(
      call.headers.get("apikey"),
      "service-secret",
    );
    assert.equal(
      call.headers.get("authorization"),
      "Bearer service-secret",
    );
    assert.equal(
      call.headers
        .get("authorization")
        ?.includes("user-token"),
      false,
    );
  }
});

test("invalid Supabase identity stops before membership or Case store", async () => {
  const boundary =
    new FakeSupabaseBoundary();
  const app = runtime(boundary);

  const response = await app.handle(
    new Request(
      "https://care.example.test/api/care-ops/tenants/provider-a/queue",
      {
        headers: {
          authorization:
            "Bearer invalid-user-token",
        },
      },
    ),
  );

  assert.equal(response.status, 401);
  assert.equal(boundary.calls.length, 1);
  assert.equal(
    boundary.calls[0]?.url.pathname,
    "/auth/v1/user",
  );
});

test("runtime public object does not expose secret-bearing adapters", () => {
  const boundary =
    new FakeSupabaseBoundary();
  const app = runtime(boundary);

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
  assert.equal(
    typeof app.handle,
    "function",
  );
});

test("runtime rejects ambiguous or incomplete deployment config", () => {
  const boundary =
    new FakeSupabaseBoundary();

  assert.throws(() =>
    createSupabaseCareOpsRuntime({
      supabaseUrl:
        "https://project.supabase.test",
      publishableKey: "same-key",
      serviceRoleKey: "same-key",
      slaPolicies: {
        "provider-a": policy,
      },
      fetchImpl: boundary.fetch,
    }),
  );

  assert.throws(() =>
    createSupabaseCareOpsRuntime({
      supabaseUrl:
        "https://project.supabase.test",
      publishableKey: "publishable-key",
      serviceRoleKey: "service-secret",
      slaPolicies: {},
      fetchImpl: boundary.fetch,
    }),
  );
});
