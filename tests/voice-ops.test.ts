import test from "node:test";
import assert from "node:assert/strict";

import {
  DemoIndonesianGuidanceTranslator,
  RuleBasedDemoIncidentExtractor,
  approveCommunication,
  buildVoiceOpsPlan,
  normalizeAssemblyAiTurn,
  toCommunicationOutbox,
} from "../src/voice/index.ts";

const capturedAt = "2026-09-28T16:20:00+09:00";

test("final AssemblyAI turn becomes evidence and near-miss plan", async () => {
  const transcript = normalizeAssemblyAiTurn({
    transcriptId: "voice-001",
    text:
      "田中さんが立ち上がった時にふらつきました。転倒はしていません。今は座っています。こういう対応は初めてです。どうすればいいですか？",
    language: "ja",
    capturedAt,
    isFinal: true,
  });

  const result = await buildVoiceOpsPlan({
    tenantId: "tenant-demo",
    caseId: "CASE-VOICE-001",
    subjectId: "subject-demo-001",
    locale: "ja-JP",
    transcript,
    extractor: new RuleBasedDemoIncidentExtractor(),
    translator: new DemoIndonesianGuidanceTranslator(),
  });

  assert.equal(result.incident.kind, "near_miss");
  assert.equal(result.incident.needsGuidance, true);
  assert.equal(result.signal.sourceAdapter, "assemblyai-realtime");
  assert.equal(result.signal.type, "manual");
  assert.ok(
    result.guidance.actions.some(
      (item) => item.id === "observe-condition",
    ),
  );
  assert.equal(result.communicationDrafts.length, 2);
  assert.ok(
    result.communicationDrafts.every(
      (item) => item.requiresHumanApproval,
    ),
  );
});

test("Indonesian guidance preserves SOP action IDs", async () => {
  const transcript = normalizeAssemblyAiTurn({
    transcriptId: "voice-id-001",
    text:
      "Saya kurang paham bahasa Jepang. Pengguna hampir jatuh saat berdiri. Apa yang harus saya lakukan?",
    language: "id",
    capturedAt,
    isFinal: true,
  });

  const result = await buildVoiceOpsPlan({
    tenantId: "tenant-demo",
    caseId: "CASE-VOICE-002",
    subjectId: "subject-demo-002",
    locale: "id-ID",
    transcript,
    extractor: new RuleBasedDemoIncidentExtractor(),
    translator: new DemoIndonesianGuidanceTranslator(),
  });

  assert.equal(result.guidance.locale, "id-ID");
  assert.equal(result.guidance.heading, "Langkah berikutnya");
  assert.ok(
    result.guidance.actions.some(
      (item) =>
        item.id === "observe-condition" &&
        item.instruction.includes("Periksa"),
    ),
  );
});

test("communication requires explicit approval before outbox payload", () => {
  const draft = {
    id: "CASE-1:family:1",
    caseId: "CASE-1",
    audience: "family",
    channel: "message",
    body: "Synthetic family update",
    requiresHumanApproval: true,
  } as const;

  const approved = approveCommunication(
    draft,
    "responder-demo",
    "2026-09-28T16:25:00+09:00",
  );
  const queued = toCommunicationOutbox(
    "tenant-demo",
    approved,
  );

  assert.equal(queued.topic, "care_ops.communication");
  assert.equal(
    queued.deliveryKey,
    "voice-communication:CASE-1:family:1",
  );
  assert.equal(
    (queued.payload as { approvedBy: string }).approvedBy,
    "responder-demo",
  );

  const replay = toCommunicationOutbox(
    "tenant-demo",
    approveCommunication(
      draft,
      "responder-demo",
      "2026-09-28T16:26:00+09:00",
    ),
  );

  assert.equal(
    replay.deliveryKey,
    queued.deliveryKey,
  );
});

test("partial AssemblyAI turn is rejected", () => {
  assert.throws(
    () =>
      normalizeAssemblyAiTurn({
        transcriptId: "voice-partial",
        text: "partial",
        capturedAt,
        isFinal: false,
      }),
    /Only final AssemblyAI turns/,
  );
});


test("natural Japanese STT negation variants remain near-miss instead of false fall", async () => {
  const extractor =
    new RuleBasedDemoIncidentExtractor();

  for (
    const text of [
      "立ち上がりでふらつきましたが、転倒してないです。今は座ってます。どうしたらいいですか。",
      "少しよろけました。転倒はありません。椅子に座っています。",
      "バランスを崩しましたが転んでいません。現在は着座しています。",
      "転倒には至らず、今は座っています。どう対応すればよいですか。",
    ]
  ) {
    const result =
      await extractor.extract({
        subjectId:
          "subject-demo-variant",
        transcript: {
          provider:
            "assemblyai",
          transcriptId:
            "voice-variant",
          text,
          language:
            "ja",
          capturedAt,
        },
      });

    assert.equal(
      result.kind,
      "near_miss",
      text,
    );
    assert.equal(
      result.observations.find(
        (item) =>
          item.key ===
            "fall_occurred",
      )?.state,
      "denied",
      text,
    );
  }
});

test("ambiguous fall wording remains fail-closed as incident", async () => {
  const extractor =
    new RuleBasedDemoIncidentExtractor();

  const result =
    await extractor.extract({
      subjectId:
        "subject-demo-ambiguous",
      transcript: {
        provider:
          "assemblyai",
        transcriptId:
          "voice-ambiguous",
        text:
          "利用者がふらつきました。転倒したかは確認できていません。",
        language:
          "ja",
        capturedAt,
      },
    });

  assert.equal(
    result.kind,
    "incident",
  );
  assert.equal(
    result.observations.find(
      (item) =>
        item.key ===
          "fall_occurred",
    )?.state,
    "unknown",
  );
});

test("Indonesian no-fall wording does not collide with generic jatuh token", async () => {
  const extractor =
    new RuleBasedDemoIncidentExtractor();

  const result =
    await extractor.extract({
      subjectId:
        "subject-demo-id",
      transcript: {
        provider:
          "assemblyai",
        transcriptId:
          "voice-id-no-fall",
        text:
          "Pengguna hampir jatuh tetapi tidak jatuh. Sekarang duduk.",
        language:
          "id",
        capturedAt,
      },
    });

  assert.equal(
    result.kind,
    "near_miss",
  );
});


test("fever with collapse does not become an explicit fall", async () => {
  const extractor =
    new RuleBasedDemoIncidentExtractor();

  const result =
    await extractor.extract({
      subjectId:
        "subject-demo-fever-collapse",
      transcript: {
        provider:
          "assemblyai",
        transcriptId:
          "voice-fever-collapse",
        text:
          "高熱を出して倒れています。どうしたらいいですか？",
        language:
          "ja",
        capturedAt,
      },
    });

  assert.equal(
    result.kind,
    "incident",
  );
  assert.equal(
    result.observations.find(
      (item) =>
        item.key ===
          "fall_occurred",
    )?.state,
    "unknown",
  );
  assert.equal(
    result.observations.find(
      (item) =>
        item.key ===
          "collapse_occurred",
    )?.state,
    "confirmed",
  );
  assert.equal(
    result.observations.find(
      (item) =>
        item.key === "fever",
    )?.state,
    "confirmed",
  );
  assert.match(
    result.summary,
    /発熱.*倒れ込み/,
  );
});

test("explicit Japanese fall remains an explicit fall", async () => {
  const extractor =
    new RuleBasedDemoIncidentExtractor();

  const result =
    await extractor.extract({
      subjectId:
        "subject-demo-fall",
      transcript: {
        provider:
          "assemblyai",
        transcriptId:
          "voice-fall",
        text:
          "利用者が転倒しました。今は座っています。",
        language:
          "ja",
        capturedAt,
      },
    });

  assert.equal(
    result.observations.find(
      (item) =>
        item.key ===
          "fall_occurred",
    )?.state,
    "confirmed",
  );
  assert.equal(
    result.observations.find(
      (item) =>
        item.key ===
          "collapse_occurred",
    )?.state,
    "unknown",
  );
});

test("fever-collapse family draft does not invent dizziness wording", async () => {
  const transcript =
    normalizeAssemblyAiTurn({
      transcriptId:
        "voice-fever-draft",
      text:
        "高熱を出して倒れています。どうしたらいいですか？",
      language:
        "ja",
      capturedAt,
      isFinal:
        true,
    });

  const result =
    await buildVoiceOpsPlan({
      tenantId:
        "tenant-demo",
      caseId:
        "CASE-FEVER-1",
      subjectId:
        "subject-demo-fever",
      locale:
        "ja-JP",
      transcript,
      extractor:
        new RuleBasedDemoIncidentExtractor(),
      translator:
        new DemoIndonesianGuidanceTranslator(),
    });

  const family =
    result.communicationDrafts
      .find(
        (item) =>
          item.audience ===
            "family",
      );

  assert.ok(family);
  assert.match(
    family.body,
    /発熱/,
  );
  assert.doesNotMatch(
    family.body,
    /一時的なふらつき/,
  );
});
