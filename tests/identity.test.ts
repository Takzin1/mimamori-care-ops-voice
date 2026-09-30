import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthenticationError,
  AuthenticatedCareOpsGateway,
  CaseStoreCorruptionError,
  PostgrestTenantMembershipDirectory,
  SupabaseAuthAuthenticator,
  type AuthenticatedPrincipal,
  type PrincipalAuthenticator,
} from "../src/index.ts";

function jsonResponse(
  value: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Supabase authenticator verifies token against Auth user endpoint and ignores user metadata", async () => {
  const calls: Array<{
    url: URL;
    headers: Headers;
  }> = [];

  const authenticator = new SupabaseAuthAuthenticator({
    baseUrl: "https://example.supabase.co",
    publishableKey: "publishable-key",
    fetchImpl: async (input, init = {}) => {
      const url = new URL(input.toString());
      const headers = new Headers(init.headers);
      calls.push({ url, headers });

      return jsonResponse({
        id: "auth-user-001",
        email: "synthetic@example.invalid",
        user_metadata: {
          roles: ["supervisor"],
          tenantId: "attacker-controlled",
        },
      });
    },
  });

  const principal = await authenticator.authenticate(
    "verified-access-token",
  );

  assert.deepEqual(principal, {
    principalId: "auth-user-001",
    provider: "supabase-auth",
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.url.pathname,
    "/auth/v1/user",
  );
  assert.equal(
    calls[0]?.headers.get("apikey"),
    "publishable-key",
  );
  assert.equal(
    calls[0]?.headers.get("authorization"),
    "Bearer verified-access-token",
  );

  assert.equal(
    Object.hasOwn(principal, "roles"),
    false,
    "authorization roles must not be derived from user metadata",
  );
});

test("Supabase authenticator fails closed on rejected or malformed identity", async () => {
  const rejected = new SupabaseAuthAuthenticator({
    baseUrl: "https://example.supabase.co",
    publishableKey: "publishable-key",
    fetchImpl: async () =>
      jsonResponse({ message: "invalid JWT" }, 401),
  });

  await assert.rejects(
    rejected.authenticate("bad-token"),
    AuthenticationError,
  );

  const malformed = new SupabaseAuthAuthenticator({
    baseUrl: "https://example.supabase.co",
    publishableKey: "publishable-key",
    fetchImpl: async () =>
      jsonResponse({
        user_metadata: { id: "client-controlled" },
      }),
  });

  await assert.rejects(
    malformed.authenticate("token"),
    AuthenticationError,
  );
});

test("persistent membership directory maps only trusted tenant roles", async () => {
  const requests: URL[] = [];

  const directory = new PostgrestTenantMembershipDirectory({
    baseUrl: "https://example.supabase.co",
    serviceRoleKey: "service-secret",
    fetchImpl: async (input, init = {}) => {
      const url = new URL(input.toString());
      requests.push(url);

      const headers = new Headers(init.headers);
      assert.equal(headers.get("apikey"), "service-secret");
      assert.equal(
        headers.get("authorization"),
        "Bearer service-secret",
      );

      return jsonResponse([
        {
          tenant_id: "provider-a",
          principal_id: "auth-user-001",
          actor_id: "responder-a",
          roles: ["responder", "responder"],
          active: true,
        },
      ]);
    },
  });

  const membership = await directory.findByPrincipal(
    "provider-a",
    "auth-user-001",
  );

  assert.deepEqual(membership, {
    tenantId: "provider-a",
    principalId: "auth-user-001",
    actorId: "responder-a",
    roles: ["responder"],
    active: true,
  });

  assert.equal(
    requests[0]?.searchParams.get("tenant_id"),
    "eq.provider-a",
  );
  assert.equal(
    requests[0]?.searchParams.get("principal_id"),
    "eq.auth-user-001",
  );
});

test("membership directory rejects unknown roles and duplicate identities", async () => {
  const unknownRole = new PostgrestTenantMembershipDirectory({
    baseUrl: "https://example.supabase.co",
    serviceRoleKey: "service-secret",
    fetchImpl: async () =>
      jsonResponse([
        {
          tenant_id: "provider-a",
          principal_id: "auth-user-001",
          actor_id: "actor-a",
          roles: ["root"],
          active: true,
        },
      ]),
  });

  await assert.rejects(
    unknownRole.findByPrincipal(
      "provider-a",
      "auth-user-001",
    ),
    CaseStoreCorruptionError,
  );

  const duplicate = new PostgrestTenantMembershipDirectory({
    baseUrl: "https://example.supabase.co",
    serviceRoleKey: "service-secret",
    fetchImpl: async () =>
      jsonResponse([
        {
          tenant_id: "provider-a",
          principal_id: "auth-user-001",
          actor_id: "actor-a",
          roles: ["responder"],
          active: true,
        },
        {
          tenant_id: "provider-a",
          principal_id: "auth-user-001",
          actor_id: "actor-b",
          roles: ["responder"],
          active: true,
        },
      ]),
  });

  await assert.rejects(
    duplicate.findByPrincipal(
      "provider-a",
      "auth-user-001",
    ),
    CaseStoreCorruptionError,
  );
});

test("authenticated gateway injects verified principal instead of accepting caller principalId", async () => {
  const observed: unknown[] = [];

  const authenticator: PrincipalAuthenticator = {
    async authenticate(): Promise<AuthenticatedPrincipal> {
      return {
        principalId: "verified-principal",
        provider: "test-provider",
      };
    },
  };

  const caseService = {
    async execute(input: unknown) {
      observed.push(input);
      return {
        aggregate: { id: "synthetic" },
        event: { type: "acknowledged" },
      };
    },
    async get(input: unknown) {
      observed.push(input);
      return null;
    },
    async metrics(input: unknown) {
      observed.push(input);
      return {
        timeToAcknowledgeMs: null,
        timeToAssignmentMs: null,
        timeToFirstActionMs: null,
        timeToCompletionMs: null,
        handoffCount: 0,
        reopenCount: 0,
      };
    },
  };

  const queueService = {
    async list(input: unknown) {
      observed.push(input);
      return {
        tenantId: "provider-a",
        evaluatedAt: "2026-09-26T00:00:00.000Z",
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
      };
    },
  };

  const gateway = new AuthenticatedCareOpsGateway({
    authenticator,
    caseService: caseService as never,
    queueService: queueService as never,
  });

  await gateway.execute({
    accessToken: "token",
    tenantId: "provider-a",
    caseId: "case-a",
    expectedVersion: 1,
    command: { type: "acknowledge" },
  });

  await gateway.queue({
    accessToken: "token",
    tenantId: "provider-a",
  });

  assert.deepEqual(observed[0], {
    tenantId: "provider-a",
    caseId: "case-a",
    principalId: "verified-principal",
    expectedVersion: 1,
    command: { type: "acknowledge" },
  });

  assert.deepEqual(observed[1], {
    tenantId: "provider-a",
    principalId: "verified-principal",
  });
});

test("authentication failure stops before Case or Queue service lookup", async () => {
  let serviceCalls = 0;

  const authenticator: PrincipalAuthenticator = {
    async authenticate(): Promise<AuthenticatedPrincipal> {
      throw new AuthenticationError();
    },
  };

  const caseService = {
    async get() {
      serviceCalls += 1;
      return null;
    },
  };

  const queueService = {
    async list() {
      serviceCalls += 1;
      return null;
    },
  };

  const gateway = new AuthenticatedCareOpsGateway({
    authenticator,
    caseService: caseService as never,
    queueService: queueService as never,
  });

  await assert.rejects(
    gateway.get({
      accessToken: "invalid",
      tenantId: "provider-a",
      caseId: "secret-case",
    }),
    AuthenticationError,
  );

  await assert.rejects(
    gateway.queue({
      accessToken: "invalid",
      tenantId: "provider-a",
    }),
    AuthenticationError,
  );

  assert.equal(serviceCalls, 0);
});


test("membership actor lookup rejects unsafe filter syntax before fetch", async () => {
  let fetchCalls = 0;

  const directory =
    new PostgrestTenantMembershipDirectory({
      baseUrl:
        "https://example.supabase.co",
      serviceRoleKey:
        "service-secret",
      fetchImpl: async () => {
        fetchCalls += 1;
        return jsonResponse([]);
      },
    });

  assert.throws(
    () =>
      directory.findByActorId(
        "provider-a",
        "responder-a,or(actor_id.eq.attacker)",
      ),
    /actor id has invalid format/,
  );

  assert.equal(fetchCalls, 0);
});
