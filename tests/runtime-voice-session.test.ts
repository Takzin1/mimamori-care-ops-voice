import test from "node:test";
import assert from "node:assert/strict";

import {
  createSupabaseCareOpsRuntime,
  type CaseSlaPolicy,
  type VoiceRealtimeSessionIssuer,
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
  status = 200,
): Response {
  return new Response(
    JSON.stringify(value),
    {
      status,
      headers: {
        "content-type":
          "application/json",
      },
    },
  );
}

test("Supabase runtime mounts authenticated voice session only when issuer is configured", async () => {
  const issuer:
    VoiceRealtimeSessionIssuer = {
      async issue(
        request,
      ) {
        assert.equal(
          request.tenantId,
          "provider-a",
        );
        assert.equal(
          request.actorId,
          "responder-a",
        );
        assert.equal(
          request.caseId,
          "CASE-RUNTIME-1",
        );
        assert.equal(
          request.subjectId,
          "subject-runtime-1",
        );

        return {
          provider:
            "assemblyai",
          sessionId:
            "session-runtime",
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
    };

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

      return json(
        {
          message:
            "unexpected request",
        },
        500,
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
      voiceSessionIssuer:
        issuer,
      voiceIntegrity,
      fetchImpl,
      clock: () =>
        "2026-09-28T12:00:30Z",
    });

  const response =
    await app.handle(
      new Request(
        "https://care.example.test/api/care-ops/tenants/provider-a/voice/session",
        {
          method: "POST",
          headers: {
            authorization:
              "Bearer user-token",
            "content-type":
              "application/json",
          },
          body:
            JSON.stringify({
              caseId:
                "CASE-RUNTIME-1",
              subjectId:
                "subject-runtime-1",
              locale:
                "ja-JP",
            }),
        },
      ),
    );

  assert.equal(
    response.status,
    201,
  );

  const body =
    await response.json() as {
      session: {
        sessionId: string;
      };
      evidenceReceipt:
        string;
    };

  assert.equal(
    body.session.sessionId,
    "session-runtime",
  );
  assert.equal(
    body.evidenceReceipt,
    "test-receipt",
  );
});


test("Supabase runtime accepts modern secret key for Voice Outbox dependencies", () => {
  const issuer: VoiceRealtimeSessionIssuer = {
    async issue() {
      return {
        provider: "assemblyai",
        sessionId: "session-modern-secret",
        websocketUrl: "wss://voice.example.test/realtime",
        issuedAt: "2026-09-28T12:00:00Z",
        expiresAt: "2026-09-28T12:05:00Z",
        audio: {
          encoding: "pcm_s16le",
          sampleRateHz: 16_000,
        },
      };
    },
  };

  assert.doesNotThrow(() => {
    createSupabaseCareOpsRuntime({
      supabaseUrl:
        "https://project.supabase.test",
      publishableKey:
        "sb_publishable_test_123",
      secretKey:
        "sb_secret_test_backend_1234567890",
      slaPolicies: {
        "provider-a":
          policy,
      },
      voiceSessionIssuer:
        issuer,
      voiceIntegrity,
      fetchImpl:
        async () =>
          json({
            message:
              "not called during construction",
          }),
    });
  });
});
