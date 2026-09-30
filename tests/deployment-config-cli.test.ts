import assert from "node:assert/strict";
import {
  spawnSync,
} from "node:child_process";
import test from "node:test";

const sla = JSON.stringify({
  "provider-a": {
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
  },
});

function baseEnv() {
  return {
    ...process.env,
    CARE_OPS_ENVIRONMENT:
      "staging",
    SUPABASE_URL:
      "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY:
      "publishable-cli-secret",
    SUPABASE_SERVICE_ROLE_KEY:
      "service-role-cli-secret",
    CARE_OPS_CONSOLE_ORIGINS:
      "https://console.example.test",
    CARE_OPS_SLA_POLICIES_JSON:
      sla,
  };
}

test("deployment config CLI succeeds without echoing credentials", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/deployment-config-validate.ts",
    ],
    {
      cwd: new URL(
        "..",
        import.meta.url,
      ),
      env: baseEnv(),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0);
  assert.equal(
    result.stderr,
    "",
  );

  const report = JSON.parse(
    result.stdout,
  );

  assert.equal(
    report.status,
    "valid",
  );
  assert.equal(
    report.stage,
    "staging",
  );
  assert.equal(
    result.stdout.includes(
      "publishable-cli-secret",
    ),
    false,
  );
  assert.equal(
    result.stdout.includes(
      "service-role-cli-secret",
    ),
    false,
  );
});

test("deployment config CLI fails closed without echoing credential values", () => {
  const invalid = baseEnv();
  invalid.CARE_OPS_OUTBOX_PROVIDER_SECRET =
    "provider-cli-secret";

  const result = spawnSync(
    process.execPath,
    [
      "scripts/deployment-config-validate.ts",
    ],
    {
      cwd: new URL(
        "..",
        import.meta.url,
      ),
      env: invalid,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /must not be present/,
  );
  assert.equal(
    result.stderr.includes(
      "provider-cli-secret",
    ),
    false,
  );
  assert.equal(
    result.stderr.includes(
      "service-role-cli-secret",
    ),
    false,
  );
});
