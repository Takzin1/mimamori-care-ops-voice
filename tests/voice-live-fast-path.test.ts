import test from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";

test("Live Voice fast path keeps auth prefetch in memory only", async () => {
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
      "cachedPreviewAccessToken",
    ),
  );
  assert.ok(
    source.includes(
      "void cachedPreviewAccessToken()",
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

test("Live Voice starts mic permission and session request in parallel", async () => {
  const source =
    await readFile(
      new URL(
        "../public/live-controller.js",
        import.meta.url,
      ),
      "utf8",
    );

  assert.ok(
    source.includes(
      "const sessionRequest =",
    ),
  );
  assert.ok(
    source.includes(
      "const microphoneRequest =",
    ),
  );
  assert.ok(
    source.includes(
      "await Promise.all([",
    ),
  );
  assert.ok(
    source.includes(
      "const planRequest =",
    ),
  );
  assert.ok(
    source.includes(
      "const cleanup =",
    ),
  );
});
