import assert from "node:assert/strict";
import test from "node:test";

import {
  ExactBrowserOriginPolicy,
  OperationalCareOpsRuntime,
  createOperationalSupabaseCareOpsRuntime,
  type CaseSlaPolicy,
  type OperationalSupabaseCareOpsRuntimeOptions,
} from "../src/index.ts";

const allowedOrigin =
  "https://console.example.test";

function request(
  path =
    "/api/care-ops/tenants/provider-a/queue",
  init: RequestInit = {},
): Request {
  return new Request(
    "https://api.example.test" + path,
    init,
  );
}

test("exact browser origin policy accepts only canonical exact origins", () => {
  const policy =
    new ExactBrowserOriginPolicy([
      allowedOrigin,
    ]);

  assert.equal(
    policy.allows(allowedOrigin),
    true,
  );
  assert.equal(
    policy.allows(
      "https://evil.console.example.test",
    ),
    false,
  );
  assert.equal(
    policy.allows(
      "https://console.example.test.evil.test",
    ),
    false,
  );
  assert.equal(
    policy.allows("null"),
    false,
  );
  assert.equal(
    policy.allows("*"),
    false,
  );

  assert.throws(
    () =>
      new ExactBrowserOriginPolicy([
        "*",
      ]),
  );
  assert.throws(
    () =>
      new ExactBrowserOriginPolicy([
        "https://console.example.test/path",
      ]),
  );
});

test("allowed origin is echoed exactly without credentialed CORS", async () => {
  const runtime =
    new OperationalCareOpsRuntime({
      originPolicy:
        new ExactBrowserOriginPolicy([
          allowedOrigin,
        ]),
      handler: {
        async handle() {
          return new Response(
            JSON.stringify({ ok: true }),
            { status: 200 },
          );
        },
      },
    });

  const response =
    await runtime.handle(
      request(undefined, {
        headers: {
          origin: allowedOrigin,
        },
      }),
    );

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get(
      "access-control-allow-origin",
    ),
    allowedOrigin,
  );
  assert.match(
    response.headers.get("vary") ?? "",
    /Origin/i,
  );
  assert.equal(
    response.headers.get(
      "access-control-allow-credentials",
    ),
    null,
  );
});

test("disallowed and malformed origins fail before admission or handler", async () => {
  for (const origin of [
    "https://evil.example.test",
    "https://console.example.test/",
    "null",
    "*",
  ]) {
    let admissionCalls = 0;
    let handlerCalls = 0;

    const runtime =
      new OperationalCareOpsRuntime({
        originPolicy:
          new ExactBrowserOriginPolicy([
            allowedOrigin,
          ]),
        admission: {
          admit() {
            admissionCalls += 1;
            return { allowed: true };
          },
        },
        handler: {
          async handle() {
            handlerCalls += 1;
            return new Response("unexpected");
          },
        },
        requestIdFactory:
          () => "origin-denied",
      });

    const response =
      await runtime.handle(
        request(undefined, {
          headers: { origin },
        }),
      );

    assert.equal(response.status, 403);
    assert.equal(admissionCalls, 0);
    assert.equal(handlerCalls, 0);
    assert.equal(
      response.headers.get(
        "access-control-allow-origin",
      ),
      null,
    );
    assert.equal(
      response.headers.get(
        "access-control-allow-credentials",
      ),
      null,
    );
  }
});

test("allowed preflight is narrow and bypasses admission/application work", async () => {
  let admissionCalls = 0;
  let handlerCalls = 0;

  const runtime =
    new OperationalCareOpsRuntime({
      originPolicy:
        new ExactBrowserOriginPolicy([
          allowedOrigin,
        ]),
      admission: {
        admit() {
          admissionCalls += 1;
          return { allowed: true };
        },
      },
      handler: {
        async handle() {
          handlerCalls += 1;
          return new Response("unexpected");
        },
      },
    });

  const response =
    await runtime.handle(
      request(undefined, {
        method: "OPTIONS",
        headers: {
          origin: allowedOrigin,
          "access-control-request-method":
            "POST",
          "access-control-request-headers":
            "authorization, content-type",
        },
      }),
    );

  assert.equal(response.status, 204);
  assert.equal(admissionCalls, 0);
  assert.equal(handlerCalls, 0);
  assert.equal(
    response.headers.get(
      "access-control-allow-origin",
    ),
    allowedOrigin,
  );
  assert.equal(
    response.headers.get(
      "access-control-allow-methods",
    ),
    "POST",
  );
  assert.equal(
    response.headers.get(
      "access-control-allow-headers",
    ),
    "Authorization, Content-Type",
  );
  assert.equal(
    response.headers.get(
      "access-control-max-age",
    ),
    "600",
  );
  assert.equal(
    response.headers.get(
      "access-control-allow-credentials",
    ),
    null,
  );
});

test("preflight rejects unapproved methods and headers", async () => {
  for (const headers of [
    {
      origin: allowedOrigin,
      "access-control-request-method":
        "DELETE",
    },
    {
      origin: allowedOrigin,
      "access-control-request-method":
        "POST",
      "access-control-request-headers":
        "authorization, x-admin-secret",
    },
  ]) {
    const runtime =
      new OperationalCareOpsRuntime({
        originPolicy:
          new ExactBrowserOriginPolicy([
            allowedOrigin,
          ]),
        handler: {
          async handle() {
            return new Response("unexpected");
          },
        },
        requestIdFactory:
          () => "preflight-rejected",
      });

    const response =
      await runtime.handle(
        request(undefined, {
          method: "OPTIONS",
          headers,
        }),
      );

    assert.equal(response.status, 403);
    assert.equal(
      response.headers.get(
        "access-control-allow-origin",
      ),
      allowedOrigin,
    );
    assert.equal(
      response.headers.get(
        "access-control-allow-credentials",
      ),
      null,
    );
  }
});

test("origin policy failure fails closed before admission/application work", async () => {
  let admissionCalls = 0;
  let handlerCalls = 0;

  const runtime =
    new OperationalCareOpsRuntime({
      originPolicy: {
        allows() {
          throw new Error(
            "private policy backend detail",
          );
        },
      },
      admission: {
        admit() {
          admissionCalls += 1;
          return { allowed: true };
        },
      },
      handler: {
        async handle() {
          handlerCalls += 1;
          return new Response("unexpected");
        },
      },
      requestIdFactory:
        () => "origin-policy-error",
    });

  const response =
    await runtime.handle(
      request(undefined, {
        headers: {
          origin: allowedOrigin,
        },
      }),
    );

  assert.equal(response.status, 503);
  assert.equal(admissionCalls, 0);
  assert.equal(handlerCalls, 0);
  assert.equal(
    (await response.text()).includes(
      "private policy backend detail",
    ),
    false,
  );
});

const minute = 60_000;
const policy: CaseSlaPolicy = {
  critical: {
    acknowledgeWithinMs: minute,
    assignWithinMs: minute,
    firstActionWithinMs: minute,
    handoffAcceptWithinMs: minute,
    completeWithinMs: minute,
  },
  high: {
    acknowledgeWithinMs: minute,
    assignWithinMs: minute,
    firstActionWithinMs: minute,
    handoffAcceptWithinMs: minute,
    completeWithinMs: minute,
  },
  normal: {
    acknowledgeWithinMs: minute,
    assignWithinMs: minute,
    firstActionWithinMs: minute,
    handoffAcceptWithinMs: minute,
    completeWithinMs: minute,
  },
  low: {
    acknowledgeWithinMs: minute,
    assignWithinMs: minute,
    firstActionWithinMs: minute,
    handoffAcceptWithinMs: minute,
    completeWithinMs: minute,
  },
};

test("production Supabase runtime rejects missing browser origin policy", () => {
  const missingOriginPolicy = {
    admission: {
      admit: () => ({
        allowed: true as const,
      }),
    },
    runtime: {
      supabaseUrl:
        "https://project.supabase.test",
      publishableKey:
        "publishable-key",
      serviceRoleKey:
        "service-secret",
      slaPolicies: {
        "provider-a": policy,
      },
    },
  } as unknown as
    OperationalSupabaseCareOpsRuntimeOptions;

  assert.throws(
    () =>
      createOperationalSupabaseCareOpsRuntime(
        missingOriginPolicy,
      ),
    /browser origin policy is required/,
  );
});

test("production origin denial causes zero admission and Supabase work", async () => {
  let admissionCalls = 0;
  let fetchCalls = 0;

  const app =
    createOperationalSupabaseCareOpsRuntime({
      originPolicy:
        new ExactBrowserOriginPolicy([
          allowedOrigin,
        ]),
      admission: {
        admit() {
          admissionCalls += 1;
          return {
            allowed: true as const,
          };
        },
      },
      runtime: {
        supabaseUrl:
          "https://project.supabase.test",
        publishableKey:
          "publishable-key",
        serviceRoleKey:
          "service-secret",
        slaPolicies: {
          "provider-a": policy,
        },
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error(
            "must not reach Supabase",
          );
        },
      },
    });

  const response =
    await app.handle(
      request(undefined, {
        headers: {
          origin:
            "https://evil.example.test",
        },
      }),
    );

  assert.equal(response.status, 403);
  assert.equal(admissionCalls, 0);
  assert.equal(fetchCalls, 0);
});
