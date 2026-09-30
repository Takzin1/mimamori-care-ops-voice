import test from "node:test";
import assert from "node:assert/strict";

import {
  ClaudeGuidanceTranslator,
  recommendNextActions,
  RuleBasedDemoIncidentExtractor,
} from "../src/voice/index.ts";

test("Claude guidance adapter preserves SOP action IDs and required/source semantics", async () => {
  const extractor =
    new RuleBasedDemoIncidentExtractor();

  const incident =
    await extractor.extract({
      subjectId:
        "subject-demo",
      transcript: {
        provider:
          "assemblyai",
        transcriptId:
          "turn-1",
        text:
          "田中さんがふらつきました。転倒なし。どうすればいいですか？",
        language:
          "ja",
        capturedAt:
          "2026-09-29T02:00:00Z",
      },
    });

  const plan =
    recommendNextActions(
      incident,
    );

  const translator =
    new ClaudeGuidanceTranslator({
      transport: {
        async localize(
          request,
        ) {
          return {
            heading:
              "Langkah berikutnya",
            boundaryMessage:
              "Panduan ini tidak menggantikan SOP atau keputusan petugas.",
            actions:
              request.actions.map(
                (action) => ({
                  id:
                    action.id,
                  label:
                    `ID ${action.id}`,
                  instruction:
                    `Terjemahan: ${action.instruction}`,
                }),
              ),
          };
        },
      },
    });

  const result =
    await translator.translate({
      plan,
      locale:
        "id-ID",
    });

  assert.deepEqual(
    result.actions.map(
      (item) =>
        item.id,
    ),
    plan.actions.map(
      (item) =>
        item.id,
    ),
  );

  assert.deepEqual(
    result.actions.map(
      (item) =>
        item.required,
    ),
    plan.actions.map(
      (item) =>
        item.required,
    ),
  );

  assert.ok(
    result.actions.every(
      (item) =>
        item.source ===
          "sop",
    ),
  );
});

test("Claude guidance adapter fails closed when provider changes SOP action order", async () => {
  const plan = {
    policyId:
      "policy-demo",
    policyVersion:
      "1",
    boundaryMessage:
      "Human decision required",
    actions: [
      {
        id:
          "first",
        label:
          "First",
        instruction:
          "Do first",
        source:
          "sop",
        required:
          true,
      },
      {
        id:
          "second",
        label:
          "Second",
        instruction:
          "Do second",
        source:
          "sop",
        required:
          true,
      },
    ],
  } as const;

  const translator =
    new ClaudeGuidanceTranslator({
      transport: {
        async localize() {
          return {
            heading:
              "Localized",
            boundaryMessage:
              "Localized boundary",
            actions: [
              {
                id:
                  "second",
                label:
                  "Second",
                instruction:
                  "Second",
              },
              {
                id:
                  "first",
                label:
                  "First",
                instruction:
                  "First",
              },
            ],
          };
        },
      },
    });

  await assert.rejects(
    () =>
      translator.translate({
        plan,
        locale:
          "id-ID",
      }),
    /preserve SOP action IDs and order/,
  );
});
