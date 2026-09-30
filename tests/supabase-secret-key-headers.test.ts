import assert from "node:assert/strict";
import test from "node:test";

import {
  PostgrestTenantMembershipDirectory,
} from "../src/access/postgrest-membership-directory.ts";
import {
  parseCareOpsDeploymentEnvironment,
} from "../src/deployment/environment.ts";
import {
  PostgrestOutboxMonitor,
} from "../src/outbox/monitor.ts";
import {
  PostgrestOutboxStore,
} from "../src/outbox/postgrest-outbox-store.ts";
import {
  PostgrestCaseRepository,
} from "../src/persistence/postgrest-case-repository.ts";
import {
  createSupabaseServerCredential,
  supabaseServerHeaders,
} from "../src/supabase/server-credential.ts";

const SECRET_KEY =
  "sb_secret_test_backend_1234567890";
const BASE_URL =
  "https://example.supabase.co";

function assertModernSecretHeaders(
  init: RequestInit | undefined,
): void {
  const headers =
    new Headers(init?.headers);

  assert.equal(
    headers.get("apikey"),
    SECRET_KEY,
  );
  assert.equal(
    headers.has("authorization"),
    false,
    "sb_secret_ credentials must never be sent as Authorization: Bearer",
  );
}

test(
  "modern Supabase secret key uses apikey only",
  () => {
    const credential =
      createSupabaseServerCredential({
        secretKey: SECRET_KEY,
        serviceRoleKey:
          "legacy-service-role",
      });

    assert.equal(
      credential.kind,
      "secret",
    );

    const headers =
      supabaseServerHeaders(
        credential,
      );

    assert.equal(
      headers.get("apikey"),
      SECRET_KEY,
    );
    assert.equal(
      headers.has("authorization"),
      false,
    );
  },
);

test(
  "legacy service-role fallback preserves Bearer compatibility",
  () => {
    const legacy =
      "legacy-service-role";
    const credential =
      createSupabaseServerCredential({
        serviceRoleKey: legacy,
      });
    const headers =
      supabaseServerHeaders(
        credential,
      );

    assert.equal(
      credential.kind,
      "legacy-service-role",
    );
    assert.equal(
      headers.get("apikey"),
      legacy,
    );
    assert.equal(
      headers.get("authorization"),
      `Bearer ${legacy}`,
    );
  },
);

test(
  "deployment prefers SUPABASE_SECRET_KEY and retains legacy fallback",
  () => {
    const env = {
      CARE_OPS_ENVIRONMENT:
        "staging",
      SUPABASE_URL:
        BASE_URL,
      SUPABASE_PUBLISHABLE_KEY:
        "sb_publishable_test_123",
      SUPABASE_SECRET_KEY:
        SECRET_KEY,
      SUPABASE_SERVICE_ROLE_KEY:
        "legacy-service-role",
      CARE_OPS_CONSOLE_ORIGINS:
        "https://console.example.test",
      CARE_OPS_SLA_POLICIES_JSON:
        JSON.stringify({
          "tenant-demo": {
            critical: {
              acknowledgeWithinMs: 1,
              assignWithinMs: 1,
              firstActionWithinMs: 1,
              handoffAcceptWithinMs: 1,
              completeWithinMs: 1,
            },
            high: {
              acknowledgeWithinMs: 1,
              assignWithinMs: 1,
              firstActionWithinMs: 1,
              handoffAcceptWithinMs: 1,
              completeWithinMs: 1,
            },
            normal: {
              acknowledgeWithinMs: 1,
              assignWithinMs: 1,
              firstActionWithinMs: 1,
              handoffAcceptWithinMs: 1,
              completeWithinMs: 1,
            },
            low: {
              acknowledgeWithinMs: 1,
              assignWithinMs: 1,
              firstActionWithinMs: 1,
              handoffAcceptWithinMs: 1,
              completeWithinMs: 1,
            },
          },
        }),
    };

    const parsed =
      parseCareOpsDeploymentEnvironment(
        env,
      );

    assert.equal(
      parsed.secretKey,
      SECRET_KEY,
    );
    assert.equal(
      parsed.serviceRoleKey,
      "legacy-service-role",
    );
  },
);

test(
  "Case Store never sends sb_secret_ as Bearer",
  async () => {
    let calls = 0;
    const repository =
      new PostgrestCaseRepository({
        baseUrl: BASE_URL,
        secretKey: SECRET_KEY,
        fetchImpl:
          async (_input, init) => {
            calls += 1;
            assertModernSecretHeaders(
              init,
            );
            return new Response(
              "[]",
              {
                status: 200,
                headers: {
                  "content-type":
                    "application/json",
                },
              },
            );
          },
      });

    assert.equal(
      await repository.load(
        "tenant-demo",
        "case-demo",
      ),
      null,
    );
    assert.equal(calls, 2);
  },
);

test(
  "Membership directory never sends sb_secret_ as Bearer",
  async () => {
    const directory =
      new PostgrestTenantMembershipDirectory({
        baseUrl: BASE_URL,
        secretKey: SECRET_KEY,
        fetchImpl:
          async (_input, init) => {
            assertModernSecretHeaders(
              init,
            );
            return new Response(
              "[]",
              {
                status: 200,
                headers: {
                  "content-type":
                    "application/json",
                },
              },
            );
          },
      });

    assert.equal(
      await directory.findByPrincipal(
        "tenant-demo",
        "principal-demo",
      ),
      null,
    );
  },
);

test(
  "Outbox store never sends sb_secret_ as Bearer",
  async () => {
    const store =
      new PostgrestOutboxStore({
        baseUrl: BASE_URL,
        secretKey: SECRET_KEY,
        fetchImpl:
          async (_input, init) => {
            assertModernSecretHeaders(
              init,
            );
            return Response.json({
              ok: true,
              created: true,
              id: 1,
            });
          },
      });

    const result =
      await store.enqueue({
        tenantId:
          "tenant-demo",
        topic:
          "voice.communication",
        deliveryKey:
          "voice-communication:test",
        payload: {
          synthetic: true,
        },
      });

    assert.equal(
      result.created,
      true,
    );
  },
);

test(
  "Outbox monitor never sends sb_secret_ as Bearer",
  async () => {
    const monitor =
      new PostgrestOutboxMonitor({
        baseUrl: BASE_URL,
        secretKey: SECRET_KEY,
        fetchImpl:
          async (_input, init) => {
            assertModernSecretHeaders(
              init,
            );
            return Response.json({
              tenantId:
                "tenant-demo",
              evaluatedAt:
                "2026-09-29T12:00:00.000Z",
              counts: {
                pending: 0,
                processing: 0,
                failed: 0,
                deadLetter: 0,
                delivered: null,
              },
              oldestActionableAt:
                null,
              oldestDeadLetterAt:
                null,
              maxAttemptCount: 0,
            });
          },
      });

    const snapshot =
      await monitor.snapshot(
        "tenant-demo",
      );

    assert.equal(
      snapshot.tenantId,
      "tenant-demo",
    );
  },
);
