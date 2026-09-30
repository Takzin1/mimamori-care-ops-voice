import test from "node:test";
import assert from "node:assert/strict";

import {
  VoiceSessionHttpApi,
} from "../src/http/index.ts";
import {
  HmacVoiceIntegrity,
  type VoiceRealtimeSessionIssuer,
} from "../src/voice/index.ts";

const now =
  "2026-09-28T12:00:00Z";
const integrity =
  new HmacVoiceIntegrity(
    "voice-session-test-secret-0123456789",
  );

const issuer:
  VoiceRealtimeSessionIssuer = {
    async issue(
      request,
    ) {
      assert.equal(
        request.actorId,
        "responder-demo",
      );
      assert.equal(
        request.caseId,
        "CASE-VOICE-1",
      );
      assert.equal(
        request.subjectId,
        "subject-demo-1",
      );

      return {
        provider:
          "assemblyai",
        sessionId:
          "session-001",
        websocketUrl:
          "wss://voice.example.test/realtime",
        issuedAt: now,
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

test("authenticated operator can request voice session", async () => {
  const api =
    new VoiceSessionHttpApi({
      gateway: {
        async operatorContext(
          input,
        ) {
          assert.equal(
            input.accessToken,
            "token-demo",
          );
          assert.equal(
            input.tenantId,
            "tenant-demo",
          );

          return {
            tenantId:
              "tenant-demo",
            actorId:
              "responder-demo",
            roles: [
              "responder",
            ],
            queueVisibility:
              "responder",
          };
        },
      },
      issuer,
      integrity,
      now: () => now,
    });

  const response =
    await api.handle(
      new Request(
        "https://care.example.test/api/care-ops/tenants/tenant-demo/voice/session",
        {
          method: "POST",
          headers: {
            authorization:
              "Bearer token-demo",
            "content-type":
              "application/json",
          },
          body: JSON.stringify({
            caseId:
              "CASE-VOICE-1",
            subjectId:
              "subject-demo-1",
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
        provider: string;
        sessionId: string;
      };
    };

  assert.equal(
    body.session.provider,
    "assemblyai",
  );
  assert.equal(
    body.session.sessionId,
    "session-001",
  );
});

test("voice session endpoint rejects missing auth", async () => {
  const api =
    new VoiceSessionHttpApi({
      gateway: {
        async operatorContext() {
          throw new Error(
            "must not run",
          );
        },
      },
      issuer,
      integrity,
      now: () => now,
    });

  const response =
    await api.handle(
      new Request(
        "https://care.example.test/api/care-ops/tenants/tenant-demo/voice/session",
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
          },
          body: JSON.stringify({
            caseId:
              "CASE-VOICE-1",
            subjectId:
              "subject-demo-1",
            locale:
              "ja-JP",
          }),
        },
      ),
    );

  assert.equal(
    response.status,
    401,
  );
});


test("auditor cannot mint a Voice realtime session", async () => {
  let issued = false;

  const api =
    new VoiceSessionHttpApi({
      gateway: {
        async operatorContext() {
          return {
            tenantId:
              "tenant-demo",
            actorId:
              "auditor-demo",
            roles: [
              "auditor",
            ],
            queueVisibility:
              "tenant",
          };
        },
      },
      issuer: {
        async issue() {
          issued = true;
          throw new Error(
            "must not issue",
          );
        },
      },
      integrity,
      now: () => now,
    });

  const response =
    await api.handle(
      new Request(
        "https://care.example.test/api/care-ops/tenants/tenant-demo/voice/session",
        {
          method: "POST",
          headers: {
            authorization:
              "Bearer token-demo",
            "content-type":
              "application/json",
          },
          body:
            JSON.stringify({
              caseId:
                "CASE-VOICE-1",
              subjectId:
                "subject-demo-1",
              locale:
                "ja-JP",
            }),
        },
      ),
    );

  assert.equal(
    response.status,
    403,
  );
  assert.equal(
    issued,
    false,
  );
});
