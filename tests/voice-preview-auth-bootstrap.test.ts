import test from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";

test("Preview auth bootstrap is preview-only, same-origin, and returns no refresh token", async () => {
  const source =
    await readFile(
      new URL(
        "../api/voice-preview-auth.ts",
        import.meta.url,
      ),
      "utf8",
    );

  assert.ok(
    source.includes(
      "process.env.VERCEL_ENV !==",
    ),
  );
  assert.ok(
    source.includes(
      "\"preview\"",
    ),
  );
  assert.ok(
    source.includes(
      "origin !==",
    ),
  );
  assert.ok(
    source.includes(
      "target.origin",
    ),
  );
  assert.ok(
    source.includes(
      ".vercel.app",
    ),
  );
  assert.ok(
    source.includes(
      "SUPABASE_SECRET_KEY",
    ),
  );
  assert.ok(
    source.includes(
      "voice-preview-responder",
    ),
  );
  assert.ok(
    source.includes(
      "tenant-demo",
    ),
  );
  assert.ok(
    source.includes(
      "accessToken",
    ),
  );
  assert.ok(
    !source.includes(
      "refresh_token",
    ),
  );
  assert.ok(
    source.includes(
      "export const POST",
    ),
  );
});

test("Live UI auto-mints only when the token input is empty", async () => {
  const source =
    await readFile(
      new URL(
        "../public/app.js",
        import.meta.url,
      ),
      "utf8",
    );

  assert.ok(
    source.includes(
      "previewAccessToken",
    ),
  );
  assert.ok(
    source.includes(
      "token.value.trim() ||",
    ),
  );
  assert.ok(
    source.includes(
      "await cachedPreviewAccessToken()",
    ),
  );
  assert.ok(
    source.includes(
      'credentials:\n          "same-origin"',
    ),
  );
  assert.ok(
    !source.includes(
      "localStorage",
    ),
  );
  assert.ok(
    !source.includes(
      "sessionStorage",
    ),
  );
});
