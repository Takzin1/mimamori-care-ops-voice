import test from "node:test";
import assert from "node:assert/strict";

import {
  VoiceSessionHttpClient,
} from "../src/client/index.ts";

test("voice session client uses Care Ops bearer auth and returns validated session", async () => {
  const client =
    new VoiceSessionHttpClient({
      baseUrl:
        "https://care.example.test",
      accessTokenProvider:
        async () =>
          "care-token",
      now: () =>
        "2026-09-28T12:00:30Z",
      fetchImpl:
        async (
          input,
          init,
        ) => {
          assert.equal(
            String(input),
            "https://care.example.test/api/care-ops/tenants/tenant-demo/voice/session",
          );

          const headers =
            new Headers(
              init?.headers,
            );

          assert.equal(
            headers.get(
              "authorization",
            ),
            "Bearer care-token",
          );

          assert.deepEqual(
            JSON.parse(
              String(
                init?.body,
              ),
            ),
            {
              caseId:
                "CASE-VOICE-1",
              subjectId:
                "subject-demo-1",
              locale:
                "ja-JP",
            },
          );

          return new Response(
            JSON.stringify({
              session: {
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
              },
            }),
            {
              status: 201,
              headers: {
                "content-type":
                  "application/json",
              },
            },
          );
        },
    });

  const session =
    await client.issue({
      tenantId:
        "tenant-demo",
      caseId:
        "CASE-VOICE-1",
      subjectId:
        "subject-demo-1",
      locale:
        "ja-JP",
    });

  assert.equal(
    session.provider,
    "assemblyai",
  );
  assert.equal(
    session.audio.sampleRateHz,
    16_000,
  );
});

test("voice session client rejects long-lived provider key shaped input as Care Ops auth whitespace", async () => {
  const client =
    new VoiceSessionHttpClient({
      baseUrl:
        "https://care.example.test",
      accessTokenProvider:
        () => "bad token",
      fetchImpl:
        async () => {
          throw new Error(
            "must not fetch",
          );
        },
    });

  await assert.rejects(
    () =>
      client.issue({
        tenantId:
          "tenant-demo",
        locale:
          "ja-JP",
      }),
    /access token is invalid/,
  );
});
