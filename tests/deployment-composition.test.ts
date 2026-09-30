import assert from "node:assert/strict";
import test from "node:test";

import {
  createCareOpsDeployment,
  parseCareOpsDeploymentEnvironment,
  type DeploymentEnvironmentInput,
} from "../src/index.ts";

const policy = {
  critical: {
    acknowledgeWithinMs: 120_000,
    assignWithinMs: 120_000,
    firstActionWithinMs: 120_000,
    handoffAcceptWithinMs: 120_000,
    completeWithinMs: 900_000,
  },
  high: {
    acknowledgeWithinMs: 300_000,
    assignWithinMs: 300_000,
    firstActionWithinMs: 300_000,
    handoffAcceptWithinMs: 300_000,
    completeWithinMs: 1_800_000,
  },
  normal: {
    acknowledgeWithinMs: 600_000,
    assignWithinMs: 300_000,
    firstActionWithinMs: 300_000,
    handoffAcceptWithinMs: 300_000,
    completeWithinMs: 3_600_000,
  },
  low: {
    acknowledgeWithinMs: 1_800_000,
    assignWithinMs: 1_800_000,
    firstActionWithinMs: 1_800_000,
    handoffAcceptWithinMs: 900_000,
    completeWithinMs: 10_800_000,
  },
};

function validEnv(
  overrides: DeploymentEnvironmentInput = {},
): DeploymentEnvironmentInput {
  return {
    CARE_OPS_ENVIRONMENT: "staging",
    SUPABASE_URL:
      "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY:
      "publishable-key",
    SUPABASE_SERVICE_ROLE_KEY:
      "service-role-key",
    CARE_OPS_CONSOLE_ORIGINS:
      "https://console.example.test",
    CARE_OPS_SLA_POLICIES_JSON:
      JSON.stringify({
        "provider-a": policy,
      }),
    ...overrides,
  };
}

test("deployment parser validates and normalizes production-facing configuration", () => {
  const config =
    parseCareOpsDeploymentEnvironment(
      validEnv({
        CARE_OPS_ENVIRONMENT:
          "production",
        CARE_OPS_CONSOLE_ORIGINS:
          "https://console.example.test,https://backup-console.example.test",
        CARE_OPS_OUTBOUND_TIMEOUT_MS:
          "7500",
        CARE_OPS_MAX_COMMAND_BODY_BYTES:
          "65536",
      }),
    );

  assert.equal(
    config.stage,
    "production",
  );
  assert.equal(
    config.supabaseUrl,
    "https://example.supabase.co",
  );
  assert.deepEqual(
    config.consoleOrigins,
    [
      "https://console.example.test",
      "https://backup-console.example.test",
    ],
  );
  assert.equal(
    config.outboundTimeoutMs,
    7_500,
  );
  assert.equal(
    config.maxCommandBodyBytes,
    65_536,
  );
  assert.deepEqual(
    Object.keys(config.slaPolicies),
    ["provider-a"],
  );
});

test("deployment parser rejects insecure or ambiguous credential configuration", () => {
  assert.throws(
    () =>
      parseCareOpsDeploymentEnvironment(
        validEnv({
          SUPABASE_SERVICE_ROLE_KEY:
            "publishable-key",
        }),
      ),
    /must be different/,
  );

  assert.throws(
    () =>
      parseCareOpsDeploymentEnvironment(
        validEnv({
          CARE_OPS_MEMBERSHIP_ADMIN_SECRET:
            "admin-secret",
        }),
      ),
    /must not be present/,
  );

  assert.throws(
    () =>
      parseCareOpsDeploymentEnvironment(
        validEnv({
          CARE_OPS_OUTBOX_PROVIDER_SECRET:
            "provider-secret",
        }),
      ),
    /must not be present/,
  );

  assert.throws(
    () =>
      parseCareOpsDeploymentEnvironment(
        validEnv({
          CARE_OPS_BACKUP_OPERATOR_SECRET:
            "backup-secret",
        }),
      ),
    /must not be present/,
  );
});

test("deployment parser rejects unsafe URLs, origins, and malformed SLA policies", () => {
  assert.throws(
    () =>
      parseCareOpsDeploymentEnvironment(
        validEnv({
          SUPABASE_URL:
            "http://example.supabase.co",
        }),
      ),
    /must use https/,
  );

  assert.throws(
    () =>
      parseCareOpsDeploymentEnvironment(
        validEnv({
          CARE_OPS_CONSOLE_ORIGINS:
            "https://console.example.test/path",
        }),
      ),
    /origin/,
  );

  assert.throws(
    () =>
      parseCareOpsDeploymentEnvironment(
        validEnv({
          CARE_OPS_CONSOLE_ORIGINS:
            "https://console.example.test,https://console.example.test",
        }),
      ),
    /duplicates/,
  );

  assert.throws(
    () =>
      parseCareOpsDeploymentEnvironment(
        validEnv({
          CARE_OPS_SLA_POLICIES_JSON:
            JSON.stringify({
              "provider-a": {
                ...policy,
                normal: {
                  ...policy.normal,
                  completeWithinMs:
                    -1,
                },
              },
            }),
        }),
      ),
    /non-negative integer/,
  );
});

test("deployment parser never echoes secret values in validation errors", () => {
  const secret =
    "super-sensitive-runtime-secret";

  assert.throws(
    () =>
      parseCareOpsDeploymentEnvironment(
        validEnv({
          SUPABASE_PUBLISHABLE_KEY:
            secret,
          SUPABASE_SERVICE_ROLE_KEY:
            secret,
        }),
      ),
    (error: unknown) => {
      assert.ok(
        error instanceof Error,
      );
      assert.equal(
        error.message.includes(secret),
        false,
      );
      return true;
    },
  );
});

test("deployment composition routes through operational runtime boundaries before network adapters", async () => {
  let fetchCalls = 0;

  const app = createCareOpsDeployment({
    env: validEnv(),
    admission: {
      admit: () => ({
        allowed: true,
      }),
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error(
        "network should not be reached",
      );
    },
    readinessChecks: [
      {
        name: "synthetic-ready",
        check: () => true,
      },
    ],
    requestIdFactory: () =>
      "deployment-request-id",
  });

  const health = await app.handle(
    new Request(
      "https://api.example.test/healthz",
    ),
  );

  assert.equal(
    health.status,
    200,
  );
  assert.deepEqual(
    await health.json(),
    { status: "ok" },
  );

  const readiness =
    await app.handle(
      new Request(
        "https://api.example.test/readyz",
      ),
    );

  assert.equal(
    readiness.status,
    200,
  );
  assert.deepEqual(
    await readiness.json(),
    { status: "ready" },
  );

  const badOrigin =
    await app.handle(
      new Request(
        "https://api.example.test/api/care-ops/tenants/provider-a/queue",
        {
          headers: {
            origin:
              "https://evil.example.test",
          },
        },
      ),
    );

  assert.equal(
    badOrigin.status,
    403,
  );
  assert.equal(
    (
      await badOrigin.json() as {
        error: { code: string };
      }
    ).error.code,
    "ORIGIN_NOT_ALLOWED",
  );

  const missingAuth =
    await app.handle(
      new Request(
        "https://api.example.test/api/care-ops/tenants/provider-a/queue",
        {
          headers: {
            origin:
              "https://console.example.test",
          },
        },
      ),
    );

  assert.equal(
    missingAuth.status,
    401,
  );
  assert.equal(
    (
      await missingAuth.json() as {
        error: { code: string };
      }
    ).error.code,
    "AUTHENTICATION_REQUIRED",
  );
  assert.equal(
    missingAuth.headers.get(
      "access-control-allow-origin",
    ),
    "https://console.example.test",
  );

  assert.equal(
    fetchCalls,
    0,
  );
});
