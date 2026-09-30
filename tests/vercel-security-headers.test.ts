import test from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";

test("Vercel Preview hardening allows only trusted Vercel framing and limits microphone/connect origins", async () => {
  const config =
    JSON.parse(
      await readFile(
        new URL(
          "../vercel.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );

  const headers =
    config.headers?.[0]
      ?.headers ?? [];

  const byKey =
    new Map(
      headers.map(
        (entry) => [
          entry.key
            .toLowerCase(),
          entry.value,
        ],
      ),
    );

  assert.equal(
    byKey.has(
      "x-frame-options",
    ),
    false,
  );

  assert.match(
    byKey.get(
      "permissions-policy",
    ) ?? "",
    /microphone=\(self\)/,
  );

  const csp =
    byKey.get(
      "content-security-policy",
    ) ?? "";

  assert.match(
    csp,
    /frame-ancestors 'self' https:\/\/vercel\.com https:\/\/\*\.vercel\.com https:\/\/vercel\.live/,
  );
  assert.doesNotMatch(
    csp,
    /frame-ancestors 'none'/,
  );
  assert.match(
    csp,
    /connect-src 'self' wss:\/\/streaming\.assemblyai\.com/,
  );
  assert.doesNotMatch(
    csp,
    /unsafe-inline|unsafe-eval/,
  );
});
