import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path: string): Promise<string> {
  return readFile(
    new URL("../" + path, import.meta.url),
    "utf8",
  );
}

test("reviewer console is clearly synthetic and non-production", async () => {
  const html = await read(
    "demo/responder-console/index.html",
  );

  assert.ok(
    html.includes(
      "SYNTHETIC REVIEWER DEMO · NOT PRODUCTION · NO REAL RESIDENT DATA",
    ),
  );
  assert.ok(html.includes("Responder Console"));
  assert.ok(html.includes("Time to Completion"));
  assert.ok(html.includes("Human-in-the-loop boundary"));
});

test("reviewer console contains no production network or secret path", async () => {
  const source = await read(
    "demo/responder-console/app.js",
  );

  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("service_role"), false);
  assert.equal(source.includes("SUPABASE"), false);
  assert.equal(source.includes("Authorization"), false);
  assert.equal(source.includes("localStorage"), false);
});

test("reviewer scenario demonstrates explicit handoff ownership and evidence", async () => {
  const source = await read(
    "demo/responder-console/app.js",
  );

  assert.ok(
    source.includes(
      "ownerはまだresponder-a",
    ),
  );
  assert.ok(
    source.includes(
      "この瞬間にownerが移転",
    ),
  );
  assert.ok(
    source.includes(
      "call evidence 1件",
    ),
  );
  assert.ok(source.includes('status: "CLOSED"'));
});


test("reviewer deployment blocks outbound browser connections", async () => {
  const raw = await read(
    "demo/responder-console/vercel.json",
  );
  const config = JSON.parse(raw);

  const headers = config.headers?.[0]?.headers ?? [];
  const csp = headers.find(
    (item: { key?: string; value?: string }) =>
      item.key === "Content-Security-Policy",
  )?.value ?? "";

  assert.ok(csp.includes("connect-src 'none'"));
  assert.ok(csp.includes("form-action 'none'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.equal(config.framework, null);
});
