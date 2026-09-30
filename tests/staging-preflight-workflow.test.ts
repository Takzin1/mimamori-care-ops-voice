import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function workflow(): Promise<string> {
  return readFile(
    new URL(
      "../.github/workflows/staging-preflight.yml",
      import.meta.url,
    ),
    "utf8",
  );
}

test("staging preflight workflow remains manual, read-only, and credential-free", async () => {
  const source = await workflow();

  assert.ok(
    source.includes("workflow_dispatch:"),
  );
  assert.ok(
    source.includes("permissions:\n  contents: read"),
  );
  assert.ok(
    source.includes(
      "CARE_OPS_BASE_URL: ${{ inputs.base_url }}",
    ),
  );
  assert.ok(
    source.includes(
      "CARE_OPS_CONSOLE_ORIGIN: ${{ inputs.console_origin }}",
    ),
  );
  assert.ok(
    source.includes(
      "run: npm run preflight:staging",
    ),
  );

  assert.equal(
    source.includes("${{ secrets."),
    false,
  );
  assert.equal(
    source.includes(
      "run: npm run preflight:staging -- --base-url ${{",
    ),
    false,
  );
  assert.equal(
    source.includes("permissions:\n  contents: write"),
    false,
  );
});

test("staging preflight workflow keeps immutable action refs and bounded runtime", async () => {
  const source = await workflow();

  assert.ok(
    source.includes(
      "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
    ),
  );
  assert.ok(
    source.includes(
      "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444",
    ),
  );
  assert.ok(
    source.includes("timeout-minutes: 5"),
  );
  assert.ok(
    source.includes(
      "npm ci --ignore-scripts --no-audit --no-fund",
    ),
  );
});
