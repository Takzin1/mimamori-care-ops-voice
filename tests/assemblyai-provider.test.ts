import test from "node:test";
import assert from "node:assert/strict";

import {
  AssemblyAiRealtimeSessionIssuer,
  parseAssemblyAiRealtimeMessage,
} from "../src/voice/index.ts";

test("AssemblyAI issuer keeps long-lived key server-side and returns short-lived WSS session", async () => {
  const issuer =
    new AssemblyAiRealtimeSessionIssuer({
      apiKey:
        "server-secret-key",
      now: () =>
        "2026-09-28T12:00:00Z",
      sessionTtlSeconds:
        120,
      fetchImpl:
        async (
          input,
          init,
        ) => {
          const tokenUrl =
            new URL(
              input.toString(),
            );

          assert.equal(
            tokenUrl.origin +
              tokenUrl.pathname,
            "https://streaming.assemblyai.com/v3/token",
          );
          assert.equal(
            tokenUrl.searchParams.get(
              "expires_in_seconds",
            ),
            "120",
          );
          assert.equal(
            init?.method,
            "GET",
          );
          assert.equal(
            init?.body,
            undefined,
          );

          const headers =
            new Headers(
              init?.headers,
            );

          assert.equal(
            headers.get(
              "authorization",
            ),
            "server-secret-key",
          );

          return new Response(
            JSON.stringify({
              token:
                "short-lived-token",
            }),
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

  const session =
    await issuer.issue({
      tenantId:
        "tenant-demo",
      actorId:
        "responder-demo",
      caseId:
        "CASE-VOICE-1",
      subjectId:
        "subject-demo-1",
      locale:
        "ja-JP",
    });

  const url =
    new URL(
      session.websocketUrl,
    );

  assert.equal(
    url.origin,
    "wss://streaming.assemblyai.com",
  );
  assert.equal(
    url.pathname,
    "/v3/ws",
  );
  assert.equal(
    url.searchParams.get(
      "sample_rate",
    ),
    "16000",
  );
  assert.equal(
    url.searchParams.get(
      "token",
    ),
    "short-lived-token",
  );
  assert.match(
    session.sessionId,
    /^aai-[0-9a-f-]{36}$/i,
  );
  assert.equal(
    session.expiresAt,
    "2026-09-28T12:02:00.000Z",
  );
});

test("AssemblyAI parser only emits final Turn evidence", () => {
  const partial =
    parseAssemblyAiRealtimeMessage({
      sessionId:
        "session-1",
      capturedAt:
        "2026-09-28T12:01:00Z",
      data: JSON.stringify({
        type:
          "Turn",
        turn_order: 3,
        transcript:
          "田中さんが",
        end_of_turn:
          false,
      }),
    });

  assert.equal(
    partial,
    null,
  );

  const final =
    parseAssemblyAiRealtimeMessage({
      sessionId:
        "session-1",
      capturedAt:
        "2026-09-28T12:01:02Z",
      data: JSON.stringify({
        type:
          "Turn",
        turn_order: 3,
        transcript:
          "田中さんが立ち上がった時にふらつきました。転倒なし。",
        end_of_turn:
          true,
        language_code:
          "ja",
      }),
    });

  assert.ok(final);
  assert.equal(
    final?.provider,
    "assemblyai",
  );
  assert.equal(
    final?.transcriptId,
    "session-1:3",
  );
  assert.equal(
    final?.language,
    "ja",
  );
});

test("AssemblyAI parser ignores non-Turn control messages", () => {
  const evidence =
    parseAssemblyAiRealtimeMessage({
      sessionId:
        "session-1",
      capturedAt:
        "2026-09-28T12:01:00Z",
      data: JSON.stringify({
        type:
          "Begin",
        id:
          "provider-session",
      }),
    });

  assert.equal(
    evidence,
    null,
  );
});
