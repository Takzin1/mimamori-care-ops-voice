import test from "node:test";
import assert from "node:assert/strict";

import {
  VoiceRealtimeTransport,
  validateVoiceRealtimeSession,
  validateVoiceSessionRequest,
  type VoiceRealtimeSocket,
} from "../src/voice/index.ts";

test("voice session request rejects unsafe identifiers", () => {
  assert.throws(
    () =>
      validateVoiceSessionRequest({
        tenantId: "../tenant",
        actorId: "actor-demo",
        locale: "ja-JP",
      }),
    /tenantId is invalid/,
  );
});

test("realtime session requires non-expired wss endpoint", () => {
  const session =
    validateVoiceRealtimeSession(
      {
        provider: "assemblyai",
        sessionId: "session-demo-1",
        websocketUrl:
          "wss://voice.example.test/realtime",
        issuedAt:
          "2026-09-28T10:00:00Z",
        expiresAt:
          "2026-09-28T10:10:00Z",
        audio: {
          encoding: "pcm_s16le",
          sampleRateHz: 16_000,
        },
      },
      "2026-09-28T10:05:00Z",
    );

  assert.equal(
    session.websocketUrl,
    "wss://voice.example.test/realtime",
  );

  assert.throws(
    () =>
      validateVoiceRealtimeSession(
        {
          ...session,
          websocketUrl:
            "ws://voice.example.test/realtime",
        },
        "2026-09-28T10:05:00Z",
      ),
    /must use wss/,
  );

  assert.throws(
    () =>
      validateVoiceRealtimeSession(
        session,
        "2026-09-28T10:10:00Z",
      ),
    /expired/,
  );
});

class FakeSocket
implements VoiceRealtimeSocket {
  readyState = 0;
  binaryType:
    BinaryType = "blob";
  onopen:
    | ((event: Event) => void)
    | null = null;
  onmessage:
    | ((event: MessageEvent) => void)
    | null = null;
  onerror:
    | ((event: Event) => void)
    | null = null;
  onclose:
    | ((event: CloseEvent) => void)
    | null = null;
  sent: unknown[] = [];
  closed: {
    code?: number;
    reason?: string;
  } | null = null;

  send(
    data:
      | string
      | ArrayBufferLike
      | Blob
      | ArrayBufferView,
  ): void {
    this.sent.push(data);
  }

  close(
    code?: number,
    reason?: string,
  ): void {
    this.closed = {
      ...(code === undefined
        ? {}
        : { code }),
      ...(reason === undefined
        ? {}
        : { reason }),
    };
  }
}

test("realtime transport gates audio until socket opens", () => {
  const socket =
    new FakeSocket();
  const states:
    string[] = [];

  const transport =
    new VoiceRealtimeTransport({
      session: {
        provider:
          "assemblyai",
        sessionId:
          "session-demo",
        websocketUrl:
          "wss://voice.example.test/realtime",
        issuedAt:
          "2026-09-28T10:00:00Z",
        expiresAt:
          "2026-09-28T10:10:00Z",
        audio: {
          encoding:
            "pcm_s16le",
          sampleRateHz:
            16_000,
        },
      },
      socketFactory:
        () => socket,
      handlers: {
        onState: (
          state,
        ) => {
          states.push(
            state,
          );
        },
      },
    });

  transport.connect();

  assert.equal(
    transport.state,
    "connecting",
  );

  assert.throws(
    () =>
      transport.sendAudio(
        new Uint8Array([
          1,
          2,
        ]),
      ),
    /not open/,
  );

  socket.readyState = 1;
  socket.onopen?.(
    new Event("open"),
  );

  transport.sendAudio(
    new Uint8Array([
      1,
      2,
      3,
    ]),
  );

  assert.equal(
    transport.state,
    "open",
  );
  assert.equal(
    socket.sent.length,
    1,
  );
  assert.deepEqual(
    states,
    [
      "connecting",
      "open",
    ],
  );

  transport.close();

  assert.deepEqual(
    socket.closed,
    {
      code: 1000,
      reason:
        "client complete",
    },
  );
});
