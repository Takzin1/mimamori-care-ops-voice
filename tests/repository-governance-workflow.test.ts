import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("repository governance audit workflow stays manual and read-only", async () => {
  const source = await readFile(
    new URL(
      "../.github/workflows/repository-governance-audit.yml",
      import.meta.url,
    ),
    "utf8",
  );

  assert.ok(
    source.includes(
      "workflow_dispatch:",
    ),
  );
  assert.ok(
    source.includes(
      "permissions:\n  contents: read",
    ),
  );
  assert.ok(
    source.includes(
      "GITHUB_TOKEN: ${{ github.token }}",
    ),
  );
  assert.equal(
    source.includes("${{ secrets."),
    false,
  );
  assert.ok(
    source.includes(
      "timeout-minutes: 5",
    ),
  );
  assert.ok(
    source.includes(
      "node scripts/repository-governance-audit.ts",
    ),
  );
});

test("repository governance audit keeps immutable action refs", async () => {
  const source = await readFile(
    new URL(
      "../.github/workflows/repository-governance-audit.yml",
      import.meta.url,
    ),
    "utf8",
  );

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
});
