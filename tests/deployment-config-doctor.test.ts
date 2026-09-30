import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  validateCareOpsDeploymentEnvironment,
  type DeploymentEnvironmentInput,
} from "../src/index.ts";

const policy = {
  critical: {
    acknowledgeWithinMs: 120000,
    assignWithinMs: 120000,
    firstActionWithinMs: 120000,
    handoffAcceptWithinMs: 120000,
    completeWithinMs: 900000,
  },
  high: {
    acknowledgeWithinMs: 300000,
    assignWithinMs: 300000,
    firstActionWithinMs: 300000,
    handoffAcceptWithinMs: 300000,
    completeWithinMs: 1800000,
  },
  normal: {
    acknowledgeWithinMs: 600000,
    assignWithinMs: 300000,
    firstActionWithinMs: 300000,
    handoffAcceptWithinMs: 300000,
    completeWithinMs: 3600000,
  },
  low: {
    acknowledgeWithinMs: 1800000,
    assignWithinMs: 1800000,
    firstActionWithinMs: 1800000,
    handoffAcceptWithinMs: 900000,
    completeWithinMs: 10800000,
  },
};

function env(
  overrides: DeploymentEnvironmentInput = {},
): DeploymentEnvironmentInput {
  return {
    CARE_OPS_ENVIRONMENT: "staging",
    SUPABASE_URL:
      "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY:
      "publishable-super-secret",
    SUPABASE_SERVICE_ROLE_KEY:
      "service-role-super-secret",
    CARE_OPS_CONSOLE_ORIGINS:
      "https://console.example.test",
    CARE_OPS_SLA_POLICIES_JSON:
      JSON.stringify({
        "provider-a": policy,
      }),
    ...overrides,
  };
}

test("deployment validation summary exposes only non-secret metadata", () => {
  const input = env();
  const report =
    validateCareOpsDeploymentEnvironment(
      input,
    );
  const serialized =
    JSON.stringify(report);

  assert.deepEqual(report, {
    status: "valid",
    stage: "staging",
    supabaseHost:
      "project.supabase.co",
    consoleOriginCount: 1,
    tenantPolicyCount: 1,
    outboundTimeoutMs: 5000,
    maxCommandBodyBytes: 32768,
  });

  assert.equal(
    serialized.includes(
      input.SUPABASE_PUBLISHABLE_KEY!,
    ),
    false,
  );
  assert.equal(
    serialized.includes(
      input.SUPABASE_SERVICE_ROLE_KEY!,
    ),
    false,
  );
  assert.equal(
    serialized.includes("publishableKey"),
    false,
  );
  assert.equal(
    serialized.includes("serviceRoleKey"),
    false,
  );
});

test("deployment validation fails before producing a summary for invalid config", () => {
  assert.throws(
    () =>
      validateCareOpsDeploymentEnvironment(
        env({
          CARE_OPS_CONSOLE_ORIGINS:
            "*",
        }),
      ),
    /origin/,
  );

  assert.throws(
    () =>
      validateCareOpsDeploymentEnvironment(
        env({
          CARE_OPS_OUTBOX_PROVIDER_SECRET:
            "must-not-be-here",
        }),
      ),
    /must not be present/,
  );
});

test("tracked environment template leaves runtime credentials blank and forbidden secret classes commented", async () => {
  const source = await readFile(
    new URL(
      "../.env.example",
      import.meta.url,
    ),
    "utf8",
  );

  assert.ok(
    source.includes(
      "SUPABASE_PUBLISHABLE_KEY=\n",
    ),
  );
  assert.ok(
    source.includes(
      "SUPABASE_SERVICE_ROLE_KEY=\n",
    ),
  );

  for (const name of [
    "CARE_OPS_MEMBERSHIP_ADMIN_SECRET",
    "CARE_OPS_OUTBOX_PROVIDER_SECRET",
    "CARE_OPS_BACKUP_OPERATOR_SECRET",
  ]) {
    assert.ok(
      source.includes("# " + name),
    );
    assert.equal(
      source.includes("\n" + name + "="),
      false,
    );
  }
});
