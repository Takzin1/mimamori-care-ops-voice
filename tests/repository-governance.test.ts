import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRepositoryGovernance,
} from "../src/repository-governance.ts";

test("repository governance fails for an unprotected main branch", () => {
  const report =
    evaluateRepositoryGovernance({
      protected: false,
      protection: {
        enabled: false,
        required_status_checks: {
          enforcement_level: "off",
          contexts: [],
          checks: [],
        },
      },
    });

  assert.equal(report.passed, false);
  assert.equal(report.protected, false);
  assert.deepEqual(
    report.missingChecks,
    ["verify", "postgres-integration"],
  );
});

test("repository governance requires both CI checks", () => {
  const report =
    evaluateRepositoryGovernance({
      protected: true,
      protection: {
        enabled: true,
        required_status_checks: {
          enforcement_level:
            "non_admins",
          contexts: ["verify"],
          checks: [],
        },
      },
    });

  assert.equal(report.passed, false);
  assert.deepEqual(
    report.missingChecks,
    ["postgres-integration"],
  );
});

test("repository governance passes with protection and required CI", () => {
  const report =
    evaluateRepositoryGovernance({
      protected: true,
      protection: {
        enabled: true,
        required_status_checks: {
          enforcement_level:
            "non_admins",
          contexts: ["verify"],
          checks: [
            {
              context:
                "postgres-integration",
              app_id: 15368,
            },
          ],
        },
      },
    });

  assert.equal(report.passed, true);
  assert.deepEqual(
    report.configuredChecks.sort(),
    [
      "postgres-integration",
      "verify",
    ],
  );
  assert.deepEqual(
    report.missingChecks,
    [],
  );
});
