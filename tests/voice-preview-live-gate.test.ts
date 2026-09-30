import test from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";

test("Voice Preview live gate is manual, pinned, and keeps secrets in env", async () => {
  const source =
    await readFile(
      new URL(
        "../.github/workflows/voice-preview-live-gate.yml",
        import.meta.url,
      ),
      "utf8",
    );

  assert.match(
    source,
    /workflow_dispatch:/,
  );
  assert.match(
    source,
    /actions\/checkout@[0-9a-f]{40}/,
  );
  assert.match(
    source,
    /actions\/setup-node@[0-9a-f]{40}/,
  );
  assert.doesNotMatch(
    source,
    /inputs\.preview_url/,
  );
  assert.match(
    source,
    /vars\.CARE_OPS_PREVIEW_ORIGIN/,
  );
  assert.match(
    source,
    /environment:\s*voice-preview/,
  );
  assert.match(
    source,
    /\.vercel\.app/,
  );
  assert.doesNotMatch(
    source,
    /CARE_OPS_PREVIEW_ACCESS_TOKEN/,
  );
  assert.match(
    source,
    /vars\.CARE_OPS_SUPABASE_URL/,
  );
  assert.match(
    source,
    /vars\.CARE_OPS_SUPABASE_PUBLISHABLE_KEY/,
  );
  assert.match(
    source,
    /secrets\.CARE_OPS_PREVIEW_AUTH_EMAIL/,
  );
  assert.match(
    source,
    /secrets\.CARE_OPS_PREVIEW_AUTH_PASSWORD/,
  );
  assert.match(
    source,
    /scripts\/voice-preview-auth\.mjs/,
  );
  assert.match(
    source,
    /secrets\.VERCEL_AUTOMATION_BYPASS_SECRET/,
  );
  assert.doesNotMatch(
    source,
    /echo\s+.*CARE_OPS_ACCESS_TOKEN/,
  );
  assert.doesNotMatch(
    source,
    /echo\s+.*VERCEL_AUTOMATION_BYPASS_SECRET/,
  );
  assert.match(
    source,
    /npm run voice:probe/,
  );
  assert.match(
    source,
    /npm run voice:smoke/,
  );
  assert.match(
    source,
    /npm run voice:e2e/,
  );
});
