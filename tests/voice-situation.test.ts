import test from "node:test";
import assert from "node:assert/strict";

import {
  GuardedApiSituationUnderstandingProvider,
  RuleBasedSituationUnderstandingProvider,
} from "../src/voice/index.ts";

const transcript = {
  provider:
    "assemblyai",
  transcriptId:
    "voice-situation-1",
  text:
    "高熱を出して倒れています。どうしたらいいですか？",
  language:
    "ja",
  capturedAt:
    "2026-09-30T00:00:00+09:00",
} as const;

test("rule-based situation separates collapse from explicit fall", async () => {
  const provider =
    new RuleBasedSituationUnderstandingProvider();

  const result =
    await provider.understand({
      subjectId:
        "subject-demo",
      transcript,
    });

  assert.equal(
    result.fall,
    "unknown",
  );
  assert.equal(
    result.collapse,
    "confirmed",
  );
  assert.equal(
    result.fever,
    "confirmed",
  );
  assert.equal(
    result.needsClarification,
    true,
  );
});

test("guarded API situation cannot invent critical facts absent from raw evidence", async () => {
  const provider =
    new GuardedApiSituationUnderstandingProvider({
      transport: {
        async analyze() {
          return {
            summary:
              "モデルが転倒と解釈した状態",
            fall:
              "confirmed",
            collapse:
              "confirmed",
            fever:
              "confirmed",
            clarificationQuestions: [],
          };
        },
      },
    });

  const result =
    await provider.understand({
      subjectId:
        "subject-demo",
      transcript: {
        ...transcript,
        text:
          "少し気分が悪いです。",
      },
    });

  assert.equal(
    result.fall,
    "unknown",
  );
  assert.equal(
    result.collapse,
    "unknown",
  );
  assert.equal(
    result.fever,
    "unknown",
  );
});

test("guarded API situation falls back when provider output is malformed", async () => {
  const provider =
    new GuardedApiSituationUnderstandingProvider({
      transport: {
        async analyze() {
          return {
            unexpected:
              true,
          };
        },
      },
    });

  const result =
    await provider.understand({
      subjectId:
        "subject-demo",
      transcript,
    });

  assert.equal(
    result.fall,
    "unknown",
  );
  assert.equal(
    result.collapse,
    "confirmed",
  );
  assert.equal(
    result.fever,
    "confirmed",
  );
});
