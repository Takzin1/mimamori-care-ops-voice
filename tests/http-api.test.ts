import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthenticationError,
  AuthenticatedCareOpsGateway,
  CareOpsHttpApi,
  CaseQueueService,
  CaseService,
  InMemoryCaseRepository,
  InMemoryTenantMembershipDirectory,
  InMemoryTenantSlaPolicyDirectory,
  type AuthenticatedPrincipal,
  type CaseSlaPolicy,
  type PrincipalAuthenticator,
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

class TestAuthenticator
implements PrincipalAuthenticator {
  calls = 0;

  async authenticate(
    accessToken: string,
  ): Promise<AuthenticatedPrincipal> {
    this.calls += 1;

    switch (accessToken) {
      case "token-dispatcher":
        return {
          principalId: "principal-dispatcher",
          provider: "test",
        };
      case "token-responder":
        return {
          principalId: "principal-responder",
          provider: "test",
        };
      case "token-b":
        return {
          principalId: "principal-b",
          provider: "test",
        };
      default:
        throw new AuthenticationError();
    }
  }
}

function memberships() {
  return new InMemoryTenantMembershipDirectory([
    {
      tenantId: "provider-a",
      principalId: "principal-dispatcher",
      actorId: "dispatcher",
      roles: ["dispatcher"],
      active: true,
    },
    {
      tenantId: "provider-a",
      principalId: "principal-responder",
      actorId: "responder-a",
      roles: ["responder"],
      active: true,
    },
    {
      tenantId: "provider-b",
      principalId: "principal-b",
      actorId: "dispatcher-b",
      roles: ["dispatcher"],
      active: true,
    },
  ]);
}

async function fixture(
  options: {
    maxCommandBodyBytes?: number;
  } = {},
) {
  const repository = new InMemoryCaseRepository();
  const directory = memberships();
  const authenticator = new TestAuthenticator();

  const caseService = new CaseService(
    repository,
    directory,
    () => "2026-09-25T08:00:00.000Z",
  );

  const queueService = new CaseQueueService(
    repository,
    directory,
    new InMemoryTenantSlaPolicyDirectory({
      "provider-a": policy,
      "provider-b": policy,
    }),
    () => "2026-09-25T08:05:00.000Z",
  );

  await caseService.openFromSignal(
    {
      id: "signal-a",
      tenantId: "provider-a",
      sourceAdapter: "http-test",
      subjectId: "subject-a",
      type: "non_response",
      priority: "normal",
    },
    "case-a",
  );

  await caseService.openFromSignal(
    {
      id: "signal-b",
      tenantId: "provider-b",
      sourceAdapter: "http-test",
      subjectId: "subject-b",
      type: "non_response",
      priority: "normal",
    },
    "case-b",
  );

  const gateway =
    new AuthenticatedCareOpsGateway({
      authenticator,
      caseService,
      queueService,
    });

  let requestIndex = 0;
  const api = new CareOpsHttpApi({
    gateway,
    requestIdFactory: () =>
      "request-" + String(++requestIndex),
    maxCommandBodyBytes:
      options.maxCommandBodyBytes,
  });

  return {
    api,
    authenticator,
    caseService,
  };
}

function request(
  path: string,
  init: RequestInit = {},
): Request {
  return new Request(
    "https://care.example.test" + path,
    init,
  );
}

function authHeaders(
  token = "token-dispatcher",
): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

async function body(
  response: Response,
): Promise<any> {
  return response.json() as Promise<any>;
}

test("HTTP boundary requires a syntactically valid Bearer token before gateway auth", async () => {
  const { api, authenticator } = await fixture();

  const missing = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/queue",
    ),
  );

  const malformed = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/queue",
      {
        headers: {
          authorization: "Basic abc",
        },
      },
    ),
  );

  assert.equal(missing.status, 401);
  assert.equal(malformed.status, 401);
  assert.equal(authenticator.calls, 0);

  assert.equal(
    missing.headers.get("cache-control"),
    "no-store",
  );
  assert.equal(
    missing.headers.get("x-content-type-options"),
    "nosniff",
  );
  assert.equal(
    missing.headers.get("referrer-policy"),
    "no-referrer",
  );
  assert.equal(
    missing.headers.get("vary"),
    "Authorization",
  );
  assert.equal(
    missing.headers.get("access-control-allow-origin"),
    null,
  );
  assert.equal(
    missing.headers.get("x-request-id"),
    "request-1",
  );
});

test("well-formed but invalid token is rejected by trusted authenticator", async () => {
  const { api, authenticator } = await fixture();

  const response = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/queue",
      {
        headers: authHeaders("not-valid"),
      },
    ),
  );

  assert.equal(response.status, 401);
  assert.equal(authenticator.calls, 1);

  const payload = await body(response);
  assert.deepEqual(payload, {
    error: {
      code: "AUTHENTICATION_REQUIRED",
      message: "Authentication required",
      requestId: "request-1",
    },
  });
});

test("HTTP queue is scoped by verified tenant membership", async () => {
  const { api } = await fixture();

  const response = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/queue",
      {
        headers: authHeaders(),
      },
    ),
  );

  assert.equal(response.status, 200);
  const payload = await body(response);

  assert.equal(payload.tenantId, "provider-a");
  assert.deepEqual(
    payload.items.map(
      (item: { caseId: string }) => item.caseId,
    ),
    ["case-a"],
  );
});

test("HTTP Case detail returns snapshot, events and Case version", async () => {
  const { api } = await fixture();

  const response = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/case-a",
      {
        headers: authHeaders(),
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("x-case-version"),
    "1",
  );

  const payload = await body(response);
  assert.equal(payload.aggregate.id, "case-a");
  assert.equal(payload.events.length, 1);
  assert.equal(
    payload.events[0].type,
    "case_created",
  );
});

test("HTTP metrics uses the same authenticated Case boundary", async () => {
  const { api } = await fixture();

  const response = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/case-a/metrics",
      {
        headers: authHeaders(),
      },
    ),
  );

  assert.equal(response.status, 200);
  const payload = await body(response);

  assert.deepEqual(payload, {
    timeToAcknowledgeMs: null,
    timeToAssignmentMs: null,
    timeToFirstActionMs: null,
    timeToCompletionMs: null,
    handoffCount: 0,
    reopenCount: 0,
  });
});

test("cross-tenant access denies existing and missing Case identically", async () => {
  const { api } = await fixture();

  const existing = await api.handle(
    request(
      "/api/care-ops/tenants/provider-b/cases/case-b",
      {
        headers: authHeaders(),
      },
    ),
  );

  const missing = await api.handle(
    request(
      "/api/care-ops/tenants/provider-b/cases/not-here",
      {
        headers: authHeaders(),
      },
    ),
  );

  assert.equal(existing.status, 403);
  assert.equal(missing.status, 403);

  const existingPayload = await body(existing);
  const missingPayload = await body(missing);

  assert.equal(
    existingPayload.error.code,
    "FORBIDDEN",
  );
  assert.equal(
    missingPayload.error.code,
    "FORBIDDEN",
  );
  assert.equal(
    existingPayload.error.message,
    missingPayload.error.message,
  );
});

test("HTTP command binds event actor through verified membership", async () => {
  const { api } = await fixture();

  const response = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/case-a/commands",
      {
        method: "POST",
        headers: {
          ...authHeaders(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          expectedVersion: 1,
          command: {
            type: "acknowledge",
          },
        }),
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("x-case-version"),
    "2",
  );

  const payload = await body(response);
  assert.equal(
    payload.event.actorId,
    "dispatcher",
  );
  assert.equal(
    payload.aggregate.status,
    "ACKNOWLEDGED",
  );
});

test("HTTP command rejects principalId and actorId injection before authentication or mutation", async () => {
  const {
    api,
    authenticator,
    caseService,
  } = await fixture();

  const response = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/case-a/commands",
      {
        method: "POST",
        headers: {
          ...authHeaders(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          expectedVersion: 1,
          principalId: "principal-b",
          command: {
            type: "acknowledge",
            actorId: "supervisor",
          },
        }),
      },
    ),
  );

  assert.equal(response.status, 400);
  assert.equal(authenticator.calls, 0);

  const payload = await body(response);
  assert.equal(
    payload.error.code,
    "INVALID_REQUEST",
  );

  const stored = await caseService.get({
    tenantId: "provider-a",
    caseId: "case-a",
    principalId: "principal-dispatcher",
  });

  assert.equal(stored?.aggregate.status, "NEW");
  assert.equal(stored?.aggregate.version, 1);
});

test("HTTP stale command returns stable 409 version contract", async () => {
  const { api } = await fixture();

  const first = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/case-a/commands",
      {
        method: "POST",
        headers: {
          ...authHeaders(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          expectedVersion: 1,
          command: {
            type: "acknowledge",
          },
        }),
      },
    ),
  );
  assert.equal(first.status, 200);

  const stale = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/case-a/commands",
      {
        method: "POST",
        headers: {
          ...authHeaders(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          expectedVersion: 1,
          command: {
            type: "acknowledge",
          },
        }),
      },
    ),
  );

  assert.equal(stale.status, 409);
  const payload = await body(stale);

  assert.deepEqual(payload.error.details, {
    expectedVersion: 1,
    actualVersion: 2,
  });
});

test("valid but impossible Case transition maps to 422", async () => {
  const { api } = await fixture();

  const response = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/case-a/commands",
      {
        method: "POST",
        headers: {
          ...authHeaders(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          expectedVersion: 1,
          command: {
            type: "close",
          },
        }),
      },
    ),
  );

  assert.equal(response.status, 422);
  const payload = await body(response);
  assert.equal(
    payload.error.code,
    "INVALID_CASE_TRANSITION",
  );
});

test("HTTP body reader enforces actual byte limit", async () => {
  const { api } = await fixture({
    maxCommandBodyBytes: 80,
  });

  const response = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/case-a/commands",
      {
        method: "POST",
        headers: {
          ...authHeaders(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          expectedVersion: 1,
          command: {
            type: "reopen",
            reason: "x".repeat(200),
          },
        }),
      },
    ),
  );

  assert.equal(response.status, 413);
  const payload = await body(response);
  assert.equal(
    payload.error.code,
    "REQUEST_BODY_TOO_LARGE",
  );
});

test("HTTP command requires JSON content type", async () => {
  const { api } = await fixture();

  const response = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/case-a/commands",
      {
        method: "POST",
        headers: {
          ...authHeaders(),
          "content-type": "text/plain",
        },
        body: "{}",
      },
    ),
  );

  assert.equal(response.status, 415);
  const payload = await body(response);
  assert.equal(
    payload.error.code,
    "JSON_CONTENT_TYPE_REQUIRED",
  );
});

test("HTTP route advertises its allowed method", async () => {
  const { api, authenticator } = await fixture();

  const response = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/case-a/commands",
      {
        method: "GET",
      },
    ),
  );

  assert.equal(response.status, 405);
  assert.equal(
    response.headers.get("allow"),
    "POST",
  );
  assert.equal(authenticator.calls, 0);
});

test("HTTP path rejects unsafe encoded identifiers before authentication", async () => {
  const { api, authenticator } = await fixture();

  const response = await api.handle(
    request(
      "/api/care-ops/tenants/provider%2Fa/queue",
      {
        headers: authHeaders(),
      },
    ),
  );

  assert.equal(response.status, 400);
  assert.equal(authenticator.calls, 0);

  const payload = await body(response);
  assert.equal(
    payload.error.code,
    "INVALID_PATH",
  );
});

test("authorized missing Case is 404 without leaking internal identifiers", async () => {
  const { api } = await fixture();

  const response = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/not-here",
      {
        headers: authHeaders(),
      },
    ),
  );

  assert.equal(response.status, 404);

  const payload = await body(response);
  assert.deepEqual(
    {
      code: payload.error.code,
      message: payload.error.message,
    },
    {
      code: "CASE_NOT_FOUND",
      message: "Case not found",
    },
  );

  assert.equal(
    JSON.stringify(payload).includes("provider-a"),
    false,
  );
  assert.equal(
    JSON.stringify(payload).includes("not-here"),
    false,
  );
});


test("HTTP operator context exposes safe operational identity without principalId", async () => {
  const { api } = await fixture();

  const response = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/operator",
      {
        headers: authHeaders(),
      },
    ),
  );

  assert.equal(response.status, 200);
  const payload = await body(response);

  assert.deepEqual(payload, {
    tenantId: "provider-a",
    actorId: "dispatcher",
    roles: ["dispatcher"],
    queueVisibility: "tenant",
  });

  assert.equal(
    Object.hasOwn(payload, "principalId"),
    false,
  );
});

test("HTTP Case capabilities combine verified RBAC and lifecycle state", async () => {
  const { api } = await fixture();

  const dispatcher = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/case-a/capabilities",
      {
        headers: authHeaders(),
      },
    ),
  );

  assert.equal(dispatcher.status, 200);
  const payload = await body(dispatcher);

  assert.equal(payload.caseId, "case-a");
  assert.equal(payload.version, 1);
  assert.equal(payload.status, "NEW");
  assert.deepEqual(
    payload.commands.map(
      (item: { type: string }) =>
        item.type,
    ),
    ["set_priority", "acknowledge"],
  );
  assert.equal(
    Object.hasOwn(
      payload.operator,
      "principalId",
    ),
    false,
  );

  const responder = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/case-a/capabilities",
      {
        headers:
          authHeaders("token-responder"),
      },
    ),
  );

  assert.equal(responder.status, 403);
  const responderPayload =
    await body(responder);

  assert.equal(
    responderPayload.error.code,
    "FORBIDDEN",
  );
});

test("HTTP capabilities deny cross-tenant access before Case disclosure", async () => {
  const { api } = await fixture();

  const response = await api.handle(
    request(
      "/api/care-ops/tenants/provider-b/cases/case-b/capabilities",
      {
        headers: authHeaders(),
      },
    ),
  );

  assert.equal(response.status, 403);
  const payload = await body(response);
  assert.equal(
    payload.error.code,
    "FORBIDDEN",
  );
});


test("responder cannot directly read, inspect capabilities, or acknowledge an unowned Case", async () => {
  const { api } = await fixture();

  const routes = [
    "/api/care-ops/tenants/provider-a/cases/case-a",
    "/api/care-ops/tenants/provider-a/cases/case-a/metrics",
    "/api/care-ops/tenants/provider-a/cases/case-a/capabilities",
  ];

  for (const path of routes) {
    const response = await api.handle(
      request(path, {
        headers:
          authHeaders("token-responder"),
      }),
    );

    assert.equal(response.status, 403);
    const payload = await body(response);
    assert.equal(
      payload.error.code,
      "FORBIDDEN",
    );
  }

  const command = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/case-a/commands",
      {
        method: "POST",
        headers: {
          ...authHeaders(
            "token-responder",
          ),
          "content-type":
            "application/json",
        },
        body: JSON.stringify({
          expectedVersion: 1,
          command: {
            type: "acknowledge",
          },
        }),
      },
    ),
  );

  assert.equal(command.status, 403);

  const dispatcher = await api.handle(
    request(
      "/api/care-ops/tenants/provider-a/cases/case-a",
      {
        headers: authHeaders(),
      },
    ),
  );

  assert.equal(dispatcher.status, 200);
  const stored = await body(dispatcher);
  assert.equal(
    stored.aggregate.status,
    "NEW",
  );
  assert.equal(
    stored.aggregate.version,
    1,
  );
});


test("HTTP rejects unsafe assignment actor IDs before trusted auth or lookup", async () => {
  const {
    api,
    authenticator,
  } = await fixture();

  for (const command of [
    {
      type: "assign",
      assigneeId:
        "responder-a,or(actor_id.eq.attacker)",
    },
    {
      type: "request_handoff",
      targetAssigneeId:
        "responder unsafe",
    },
  ]) {
    const response = await api.handle(
      request(
        "/api/care-ops/tenants/provider-a/cases/case-a/commands",
        {
          method: "POST",
          headers: {
            ...authHeaders(),
            "content-type":
              "application/json",
          },
          body: JSON.stringify({
            expectedVersion: 1,
            command,
          }),
        },
      ),
    );

    assert.equal(response.status, 400);
    const payload = await body(response);
    assert.equal(
      payload.error.code,
      "INVALID_REQUEST",
    );
  }

  assert.equal(
    authenticator.calls,
    0,
    "unsafe actor IDs must fail before trusted auth and membership lookup",
  );
});
