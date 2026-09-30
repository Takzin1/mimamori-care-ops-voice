import test from "node:test";
import assert from "node:assert/strict";

import {
  createSupabaseCareOpsRuntime,
  type CaseSlaPolicy,
} from "../src/index.ts";

const minute = 60_000;

const voiceIntegrity = {
  async issueSessionReceipt() {
    return "test-receipt";
  },
  async verifySessionReceipt(
    input,
  ) {
    assert.equal(
      input.receipt,
      "test-receipt",
    );
  },
  async signCommunicationDraft(
    _tenantId,
    draft,
    context,
  ) {
    return {
      ...draft,
      integrity: {
        version:
          "hmac-sha256-v1",
        signature:
          "a".repeat(43),
        caseVersion:
          context.caseVersion,
        issuedAt:
          context.now,
        expiresAt:
          "2026-09-28T12:15:30Z",
      },
    };
  },
  async verifyCommunicationDraft(
    _tenantId,
    draft,
  ) {
    const {
      integrity,
      ...unsigned
    } = draft;
    return {
      draft:
        unsigned,
      caseVersion:
        integrity.caseVersion,
      issuedAt:
        integrity.issuedAt,
      expiresAt:
        integrity.expiresAt,
    };
  },
};

const policy: CaseSlaPolicy = {
  critical: {
    acknowledgeWithinMs: 2 * minute,
    assignWithinMs: 2 * minute,
    firstActionWithinMs: 2 * minute,
    handoffAcceptWithinMs: 2 * minute,
    completeWithinMs: 15 * minute,
  },
  high: {
    acknowledgeWithinMs: 5 * minute,
    assignWithinMs: 5 * minute,
    firstActionWithinMs: 5 * minute,
    handoffAcceptWithinMs: 5 * minute,
    completeWithinMs: 30 * minute,
  },
  normal: {
    acknowledgeWithinMs: 10 * minute,
    assignWithinMs: 5 * minute,
    firstActionWithinMs: 5 * minute,
    handoffAcceptWithinMs: 5 * minute,
    completeWithinMs: 60 * minute,
  },
  low: {
    acknowledgeWithinMs: 30 * minute,
    assignWithinMs: 30 * minute,
    firstActionWithinMs: 30 * minute,
    handoffAcceptWithinMs: 15 * minute,
    completeWithinMs: 180 * minute,
  },
};

function json(
  value: unknown,
): Response {
  return new Response(
    JSON.stringify(value),
    {
      headers: {
        "content-type":
          "application/json",
      },
    },
  );
}

test("voice-enabled runtime mounts authenticated live plan route", async () => {
  let storedSnapshot: Record<string, unknown> | null = null;
  let storedEvent: Record<string, unknown> | null = null;

  const fetchImpl =
    async (
      input:
        string | URL,
      init:
        RequestInit = {},
    ): Promise<Response> => {
      const url =
        new URL(
          input.toString(),
        );
      const headers =
        new Headers(
          init.headers,
        );

      if (
        url.pathname ===
          "/auth/v1/user"
      ) {
        assert.equal(
          headers.get(
            "authorization",
          ),
          "Bearer user-token",
        );

        return json({
          id:
            "principal-a",
        });
      }

      if (
        url.pathname ===
          "/rest/v1/care_tenant_memberships"
      ) {
        return json([
          {
            tenant_id:
              "provider-a",
            principal_id:
              "principal-a",
            actor_id:
              "responder-a",
            roles: [
              "responder",
            ],
            active: true,
          },
        ]);
      }

      if (
        url.pathname.endsWith(
          "/rest/v1/rpc/create_care_case",
        )
      ) {
        const body =
          JSON.parse(
            String(
              init.body,
            ),
          );

        storedSnapshot =
          body.p_snapshot;
        storedEvent =
          body.p_event;

        return json({
          ok: true,
          created: true,
          caseId:
            body.p_snapshot.id,
          version: 1,
          snapshot:
            body.p_snapshot,
        });
      }

      if (
        url.pathname ===
          "/rest/v1/care_cases"
      ) {
        return json(
          storedSnapshot
            ? [
                {
                  case_id:
                    storedSnapshot.id,
                  snapshot:
                    storedSnapshot,
                },
              ]
            : [],
        );
      }

      if (
        url.pathname ===
          "/rest/v1/rpc/get_care_outbox_health"
      ) {
        assert.equal(
          headers.get("apikey"),
          "service-secret",
        );

        return json({
          tenantId:
            "provider-a",
          evaluatedAt:
            "2026-09-28T12:00:30Z",
          counts: {
            pending: 2,
            processing: 0,
            failed: 0,
            deadLetter: 0,
            delivered: 4,
          },
          oldestActionableAt:
            "2026-09-28T12:00:20Z",
          oldestDeadLetterAt:
            null,
          maxAttemptCount: 0,
        });
      }

      if (
        url.pathname ===
          "/rest/v1/care_case_events"
      ) {
        return json(
          storedEvent &&
          storedSnapshot
            ? [
                {
                  case_id:
                    storedSnapshot.id,
                  sequence: 1,
                  event:
                    storedEvent,
                },
              ]
            : [],
        );
      }

      throw new Error(
        `unexpected fetch: ${url.pathname}`,
      );
    };

  const app =
    createSupabaseCareOpsRuntime({
      supabaseUrl:
        "https://project.supabase.test",
      publishableKey:
        "publishable-key",
      serviceRoleKey:
        "service-secret",
      slaPolicies: {
        "provider-a":
          policy,
      },
      voiceSessionIssuer: {
        async issue() {
          return {
            provider:
              "assemblyai",
            sessionId:
              "session-demo",
            websocketUrl:
              "wss://voice.example.test/realtime",
            issuedAt:
              "2026-09-28T12:00:00Z",
            expiresAt:
              "2026-09-28T12:05:00Z",
            audio: {
              encoding:
                "pcm_s16le",
              sampleRateHz:
                16_000,
            },
          };
        },
      },
      voiceIntegrity,
      fetchImpl,
      clock: () =>
        "2026-09-28T12:00:30Z",
    });

  const response =
    await app.handle(
      new Request(
        "https://care.example.test/api/care-ops/tenants/provider-a/voice/plan",
        {
          method: "POST",
          headers: {
            authorization:
              "Bearer user-token",
            "content-type":
              "application/json",
          },
          body: JSON.stringify({
            caseId:
              "CASE-LIVE-1",
            subjectId:
              "subject-demo-1",
            locale:
              "ja-JP",
            transcript: {
              provider:
                "assemblyai",
              transcriptId:
                "session-demo:1",
              text:
                "田中さんがふらつきました。転倒なし。どうすればいいですか？",
              language:
                "ja",
              capturedAt:
                "2026-09-28T12:00:10Z",
            },
            evidenceReceipt:
              "test-receipt",
          }),
        },
      ),
    );

  assert.equal(
    response.status,
    200,
  );

  const body =
    await response.json() as {
      plan: {
        incident: {
          kind: string;
        };
      };
    };

  assert.equal(
    body.plan.incident.kind,
    "near_miss",
  );

  const healthResponse =
    await app.handle(
      new Request(
        "https://care.example.test/api/care-ops/tenants/provider-a/voice/outbox/health",
        {
          headers: {
            authorization:
              "Bearer user-token",
          },
        },
      ),
    );

  assert.equal(
    healthResponse.status,
    200,
  );

  const health =
    await healthResponse.json() as {
      outbox: {
        counts: {
          pending: number;
          failed: number;
          deadLetter: number;
          delivered: number;
        };
      };
    };

  assert.deepEqual(
    health.outbox.counts,
    {
      pending: 2,
      processing: 0,
      failed: 0,
      deadLetter: 0,
      delivered: 4,
    },
  );
});
