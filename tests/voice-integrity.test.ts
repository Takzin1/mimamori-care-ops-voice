import test from "node:test";
import assert from "node:assert/strict";

import {
  HmacVoiceIntegrity,
} from "../src/voice/index.ts";

const secret =
  "voice-integrity-test-secret-0123456789";
const boundCaseId =
  "CASE-VOICE-BOUND";
const boundSubjectId =
  "subject-voice-bound";
const draftNow =
  "2026-09-29T09:03:00Z";

test("Voice session receipt binds tenant, actor, session and timing", async () => {
  const integrity =
    new HmacVoiceIntegrity(
      secret,
    );

  const receipt =
    await integrity
      .issueSessionReceipt({
        tenantId:
          "tenant-demo",
        actorId:
          "responder-demo",
        caseId:
          boundCaseId,
        subjectId:
          boundSubjectId,
        session: {
          provider:
            "assemblyai",
          sessionId:
            "session-001",
          websocketUrl:
            "wss://streaming.assemblyai.test/v3/ws?token=short-lived",
          issuedAt:
            "2026-09-29T09:00:00Z",
          expiresAt:
            "2026-09-29T09:05:00Z",
          audio: {
            encoding:
              "pcm_s16le",
            sampleRateHz:
              16000,
          },
        },
      });

  await integrity
    .verifySessionReceipt({
      receipt,
      tenantId:
        "tenant-demo",
      actorId:
        "responder-demo",
      caseId:
        boundCaseId,
      subjectId:
        boundSubjectId,
      transcript: {
        provider:
          "assemblyai",
        transcriptId:
          "session-001:3",
        text:
          "synthetic final turn",
        language:
          "ja",
        capturedAt:
          "2026-09-29T09:03:00Z",
      },
      now:
        "2026-09-29T09:03:01Z",
    });

  await assert.rejects(
    () =>
      integrity
        .verifySessionReceipt({
          receipt,
          tenantId:
            "tenant-other",
          actorId:
            "responder-demo",
          caseId:
            boundCaseId,
          subjectId:
            boundSubjectId,
          transcript: {
            provider:
              "assemblyai",
            transcriptId:
              "session-001:3",
            text:
              "synthetic final turn",
            language:
              "ja",
            capturedAt:
              "2026-09-29T09:03:00Z",
          },
          now:
            "2026-09-29T09:03:01Z",
        }),
    /identity mismatch/,
  );

  await assert.rejects(
    () =>
      integrity
        .verifySessionReceipt({
          receipt,
          tenantId:
            "tenant-demo",
          actorId:
            "responder-demo",
          caseId:
            boundCaseId,
          subjectId:
            boundSubjectId,
          transcript: {
            provider:
              "assemblyai",
            transcriptId:
              "forged-session:1",
            text:
              "synthetic final turn",
            language:
              "ja",
            capturedAt:
              "2026-09-29T09:03:00Z",
          },
          now:
            "2026-09-29T09:03:01Z",
        }),
    /not bound/,
  );
});

test("signed communication Draft rejects body and tenant tampering", async () => {
  const integrity =
    new HmacVoiceIntegrity(
      secret,
    );
  const signed =
    await integrity
      .signCommunicationDraft(
        "tenant-demo",
        {
          id:
            "CASE-1:family:1",
          caseId:
            "CASE-1",
          audience:
            "family",
          channel:
            "message",
          body:
            "Synthetic family update",
          requiresHumanApproval:
            true,
        },
        {
          caseVersion: 1,
          now:
            draftNow,
        },
      );

  const verified =
    await integrity
      .verifyCommunicationDraft(
        "tenant-demo",
        signed,
        draftNow,
      );

  assert.equal(
    verified.draft.body,
    "Synthetic family update",
  );

  await assert.rejects(
    () =>
      integrity
        .verifyCommunicationDraft(
          "tenant-demo",
          {
            ...signed,
            body:
              "Tampered body",
          },
          draftNow,
        ),
    /integrity verification failed/,
  );

  await assert.rejects(
    () =>
      integrity
        .verifyCommunicationDraft(
          "tenant-other",
          signed,
          draftNow,
        ),
    /integrity verification failed/,
  );
});


test("Voice session receipt rejects actor replay, signature tampering and expired use", async () => {
  const integrity =
    new HmacVoiceIntegrity(
      secret,
    );

  const receipt =
    await integrity
      .issueSessionReceipt({
        tenantId:
          "tenant-demo",
        actorId:
          "responder-demo",
        caseId:
          boundCaseId,
        subjectId:
          boundSubjectId,
        session: {
          provider:
            "assemblyai",
          sessionId:
            "session-attack",
          websocketUrl:
            "wss://streaming.assemblyai.test/v3/ws?token=short-lived",
          issuedAt:
            "2026-09-29T09:00:00Z",
          expiresAt:
            "2026-09-29T09:05:00Z",
          audio: {
            encoding:
              "pcm_s16le",
            sampleRateHz:
              16000,
          },
        },
      });

  const transcript = {
    provider:
      "assemblyai",
    transcriptId:
      "session-attack:1",
    text:
      "synthetic final turn",
    language:
      "ja",
    capturedAt:
      "2026-09-29T09:03:00Z",
  } as const;

  await assert.rejects(
    () =>
      integrity
        .verifySessionReceipt({
          receipt,
          tenantId:
            "tenant-demo",
          actorId:
            "responder-other",
          caseId:
            boundCaseId,
          subjectId:
            boundSubjectId,
          transcript,
          now:
            "2026-09-29T09:03:01Z",
        }),
    /identity mismatch/,
  );

  const [payload, signature] =
    receipt.split(".");

  assert.ok(
    payload &&
    signature,
  );

  const replacement =
    signature![0] === "A"
      ? "B"
      : "A";
  const tampered =
    `${payload}.${replacement}${signature!.slice(1)}`;

  await assert.rejects(
    () =>
      integrity
        .verifySessionReceipt({
          receipt:
            tampered,
          tenantId:
            "tenant-demo",
          actorId:
            "responder-demo",
          caseId:
            boundCaseId,
          subjectId:
            boundSubjectId,
          transcript,
          now:
            "2026-09-29T09:03:01Z",
        }),
    /signature is invalid/,
  );

  await assert.rejects(
    () =>
      integrity
        .verifySessionReceipt({
          receipt,
          tenantId:
            "tenant-demo",
          actorId:
            "responder-demo",
          caseId:
            boundCaseId,
          subjectId:
            boundSubjectId,
          transcript,
          now:
            "2026-09-29T09:06:01.001Z",
        }),
    /timing is invalid/,
  );
});

test("Voice session receipt rejects transcript capture outside the issued session window", async () => {
  const integrity =
    new HmacVoiceIntegrity(
      secret,
    );

  const receipt =
    await integrity
      .issueSessionReceipt({
        tenantId:
          "tenant-demo",
        actorId:
          "responder-demo",
        caseId:
          boundCaseId,
        subjectId:
          boundSubjectId,
        session: {
          provider:
            "assemblyai",
          sessionId:
            "session-window",
          websocketUrl:
            "wss://streaming.assemblyai.test/v3/ws?token=short-lived",
          issuedAt:
            "2026-09-29T09:00:00Z",
          expiresAt:
            "2026-09-29T09:05:00Z",
          audio: {
            encoding:
              "pcm_s16le",
            sampleRateHz:
              16000,
          },
        },
      });

  await assert.rejects(
    () =>
      integrity
        .verifySessionReceipt({
          receipt,
          tenantId:
            "tenant-demo",
          actorId:
            "responder-demo",
          caseId:
            boundCaseId,
          subjectId:
            boundSubjectId,
          transcript: {
            provider:
              "assemblyai",
            transcriptId:
              "session-window:1",
            text:
              "synthetic final turn",
            language:
              "ja",
            capturedAt:
              "2026-09-29T09:05:30.001Z",
          },
          now:
            "2026-09-29T09:05:31Z",
        }),
    /timing is invalid/,
  );
});

test("signed communication Draft rejects Case and audience tampering", async () => {
  const integrity =
    new HmacVoiceIntegrity(
      secret,
    );
  const signed =
    await integrity
      .signCommunicationDraft(
        "tenant-demo",
        {
          id:
            "CASE-1:family:1",
          caseId:
            "CASE-1",
          audience:
            "family",
          channel:
            "message",
          body:
            "Synthetic family update",
          requiresHumanApproval:
            true,
        },
        {
          caseVersion: 1,
          now:
            draftNow,
        },
      );

  await assert.rejects(
    () =>
      integrity
        .verifyCommunicationDraft(
          "tenant-demo",
          {
            ...signed,
            caseId:
              "CASE-2",
          },
          draftNow,
        ),
    /integrity verification failed/,
  );

  await assert.rejects(
    () =>
      integrity
        .verifyCommunicationDraft(
          "tenant-demo",
          {
            ...signed,
            audience:
              "supervisor",
          },
          draftNow,
        ),
    /integrity verification failed/,
  );
});


test("Voice session receipt rejects case and subject replay", async () => {
  const integrity =
    new HmacVoiceIntegrity(
      secret,
    );

  const receipt =
    await integrity
      .issueSessionReceipt({
        tenantId:
          "tenant-demo",
        actorId:
          "responder-demo",
        caseId:
          boundCaseId,
        subjectId:
          boundSubjectId,
        session: {
          provider:
            "assemblyai",
          sessionId:
            "session-case-bound",
          websocketUrl:
            "wss://streaming.assemblyai.test/v3/ws?token=short-lived",
          issuedAt:
            "2026-09-29T09:00:00Z",
          expiresAt:
            "2026-09-29T09:05:00Z",
          audio: {
            encoding:
              "pcm_s16le",
            sampleRateHz:
              16000,
          },
        },
      });

  const transcript = {
    provider:
      "assemblyai",
    transcriptId:
      "session-case-bound:1",
    text:
      "synthetic final turn",
    language:
      "ja",
    capturedAt:
      "2026-09-29T09:03:00Z",
  } as const;

  await assert.rejects(
    () =>
      integrity
        .verifySessionReceipt({
          receipt,
          tenantId:
            "tenant-demo",
          actorId:
            "responder-demo",
          caseId:
            "CASE-OTHER",
          subjectId:
            boundSubjectId,
          transcript,
          now:
            "2026-09-29T09:03:01Z",
        }),
    /identity mismatch/,
  );

  await assert.rejects(
    () =>
      integrity
        .verifySessionReceipt({
          receipt,
          tenantId:
            "tenant-demo",
          actorId:
            "responder-demo",
          caseId:
            boundCaseId,
          subjectId:
            "subject-other",
          transcript,
          now:
            "2026-09-29T09:03:01Z",
        }),
    /identity mismatch/,
  );
});

test("signed communication Draft expires after TTL", async () => {
  const integrity =
    new HmacVoiceIntegrity(
      secret,
    );
  const signed =
    await integrity
      .signCommunicationDraft(
        "tenant-demo",
        {
          id:
            "CASE-1:family:1",
          caseId:
            "CASE-1",
          audience:
            "family",
          channel:
            "message",
          body:
            "Synthetic family update",
          requiresHumanApproval:
            true,
        },
        {
          caseVersion: 1,
          now:
            draftNow,
        },
      );

  await assert.rejects(
    () =>
      integrity
        .verifyCommunicationDraft(
          "tenant-demo",
          signed,
          "2026-09-29T09:18:00.001Z",
        ),
    /timing is invalid/,
  );
});
