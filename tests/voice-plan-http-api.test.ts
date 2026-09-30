import test from "node:test";
import assert from "node:assert/strict";

import {
  VoicePlanHttpApi,
} from "../src/http/index.ts";

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
    assert.ok(
      input.caseId,
    );
    assert.ok(
      input.subjectId,
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
          "2026-09-28T12:15:10Z",
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



test("authenticated voice plan endpoint turns final transcript into incident guidance", async () => {
  const api =
    new VoicePlanHttpApi({
      integrity:
        voiceIntegrity,
      now: () =>
        "2026-09-28T12:00:10Z",
      gateway: {
        async operatorContext(
          input,
        ) {
          assert.equal(
            input.accessToken,
            "token-demo",
          );

          return {
            tenantId:
              input.tenantId,
            actorId:
              "responder-demo",
            roles: [
              "responder",
            ],
            queueVisibility:
              "responder",
          };
        },

        async openFromSignal(
          input,
        ) {
          assert.equal(
            input.caseId,
            "CASE-VOICE-DEMO",
          );
          assert.equal(
            input.signal.type,
            "manual",
          );

          return {
            aggregate: {
              id:
                input.caseId,
              tenantId:
                input.tenantId,
              subjectId:
                input.signal.subjectId,
              sourceType:
                input.signal.type,
              sourceAdapter:
                input.signal.sourceAdapter,
              sourceSignalId:
                input.signal.id,
              priority:
                input.signal.priority,
              status:
                "NEW",
              version: 1,
              assigneeId:
                null,
              handoffTargetAssigneeId:
                null,
              createdAt:
                "2026-09-28T12:00:00Z",
              acknowledgedAt:
                null,
              assignedAt:
                null,
              actionStartedAt:
                null,
              handoffRequestedAt:
                null,
              handoffAcceptedAt:
                null,
              completedAt:
                null,
              closedAt:
                null,
            },
            event: {
              data: { sourceEvidence: input.signal.sourceEvidence },
              type:
                "case_created",
              tenantId:
                input.tenantId,
              caseId:
                input.caseId,
              subjectId:
                input.signal.subjectId,
              sourceType:
                input.signal.type,
              sourceAdapter:
                input.signal.sourceAdapter,
              sourceSignalId:
                input.signal.id,
              priority:
                input.signal.priority,
              at:
                "2026-09-28T12:00:00Z",
            },
            created:
              true,
          };
        },
      },
    });

  const response =
    await api.handle(
      new Request(
        "https://care.example.test/api/care-ops/tenants/tenant-demo/voice/plan",
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
              "CASE-VOICE-DEMO",
            subjectId:
              "subject-demo-001",
            locale:
              "ja-JP",
            transcript: {
              provider:
                "assemblyai",
              transcriptId:
                "session-1:3",
              text:
                "田中さんが立ち上がった時にふらつきました。転倒はしていません。今は座っています。どうすればいいですか？",
              language:
                "ja",
              capturedAt:
                "2026-09-28T12:00:00Z",
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
        guidance: {
          actions: unknown[];
        };
        communicationDrafts:
          unknown[];
      };
    };

  assert.equal(
    body.plan.incident.kind,
    "near_miss",
  );
  assert.equal(
    (
      body as {
        case: {
          id: string;
          created: boolean;
        };
      }
    ).case.id,
    "CASE-VOICE-DEMO",
  );
  assert.equal(
    (
      body as {
        case: {
          id: string;
          created: boolean;
        };
      }
    ).case.created,
    true,
  );
  assert.ok(
    body.plan.guidance
      .actions.length >= 2,
  );
  assert.equal(
    body.plan
      .communicationDrafts
      .length,
    2,
  );
});


test("auditor cannot create a Voice Case", async () => {
  let opened = false;

  const api =
    new VoicePlanHttpApi({
      integrity:
        voiceIntegrity,
      now: () =>
        "2026-09-28T12:00:10Z",
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
        async openFromSignal() {
          opened = true;
          throw new Error(
            "must not open",
          );
        },
      },
    });

  const response =
    await api.handle(
      new Request(
        "https://care.example.test/api/care-ops/tenants/tenant-demo/voice/plan",
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
                "CASE-AUDIT-1",
              subjectId:
                "subject-demo",
              locale:
                "ja-JP",
              transcript: {
                provider:
                  "assemblyai",
                transcriptId:
                  "session-audit:1",
                text:
                  "ふらつきました。",
                language:
                  "ja",
                capturedAt:
                  "2026-09-28T12:00:00Z",
              },
            }),
        },
      ),
    );

  assert.equal(
    response.status,
    403,
  );
  assert.equal(
    opened,
    false,
  );
});

test("signal replay rebinds communication drafts to canonical stored Case ID", async () => {
  const api =
    new VoicePlanHttpApi({
      integrity:
        voiceIntegrity,
      now: () =>
        "2026-09-28T12:00:10Z",
      gateway: {
        async operatorContext() {
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
        async openFromSignal(
          input,
        ) {
          return {
            aggregate: {
              id:
                "CASE-CANONICAL",
              tenantId:
                input.tenantId,
              subjectId:
                input.signal.subjectId,
              sourceType:
                input.signal.type,
              sourceAdapter:
                input.signal.sourceAdapter,
              sourceSignalId:
                input.signal.id,
              priority:
                input.signal.priority,
              status:
                "NEW",
              version: 1,
              assigneeId:
                null,
              handoffTargetAssigneeId:
                null,
              createdAt:
                "2026-09-28T12:00:00Z",
              acknowledgedAt:
                null,
              assignedAt:
                null,
              actionStartedAt:
                null,
              handoffRequestedAt:
                null,
              handoffAcceptedAt:
                null,
              completedAt:
                null,
              closedAt:
                null,
            },
            event: {
              data: { sourceEvidence: input.signal.sourceEvidence },
              type:
                "case_created",
              tenantId:
                input.tenantId,
              caseId:
                "CASE-CANONICAL",
              subjectId:
                input.signal.subjectId,
              sourceType:
                input.signal.type,
              sourceAdapter:
                input.signal.sourceAdapter,
              sourceSignalId:
                input.signal.id,
              priority:
                input.signal.priority,
              at:
                "2026-09-28T12:00:00Z",
            },
            created:
              false,
          };
        },
      },
    });

  const response =
    await api.handle(
      new Request(
        "https://care.example.test/api/care-ops/tenants/tenant-demo/voice/plan",
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
                "CASE-RETRY-PROPOSAL",
              subjectId:
                "subject-demo-001",
              locale:
                "ja-JP",
              transcript: {
                provider:
                  "assemblyai",
                transcriptId:
                  "session-replay:1",
                text:
                  "立ち上がり時にふらつきました。転倒はしていません。",
                language:
                  "ja",
                capturedAt:
                  "2026-09-28T12:00:00Z",
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
    await response.json();

  assert.equal(
    body.case.id,
    "CASE-CANONICAL",
  );
  assert.ok(
    body.plan.communicationDrafts.every(
      (draft) =>
        draft.caseId ===
          "CASE-CANONICAL" &&
        draft.id.startsWith(
          "CASE-CANONICAL:",
        ),
    ),
  );
});
