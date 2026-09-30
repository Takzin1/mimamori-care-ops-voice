import test from "node:test";
import assert from "node:assert/strict";

import {
  VoiceCommunicationHttpApi,
  VoicePlanHttpApi,
  VoiceSessionHttpApi,
} from "../src/http/index.ts";
import type {
  VoiceIntegrity,
} from "../src/voice/index.ts";

const integrity:
  VoiceIntegrity = {
    async issueSessionReceipt() {
      return "test-receipt";
    },
    async verifySessionReceipt() {},
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
            "2026-09-28T12:15:00Z",
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

function operator() {
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
  } as const;
}

test("Voice session public error hides provider details", async () => {
  const api =
    new VoiceSessionHttpApi({
      gateway: {
        async operatorContext() {
          return operator();
        },
      },
      issuer: {
        async issue() {
          throw new Error(
            "internal-provider-detail",
          );
        },
      },
      integrity,
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
                "CASE-ERR-SESSION",
              subjectId:
                "subject-demo",
              locale:
                "ja-JP",
            }),
        },
      ),
    );

  const body =
    await response.json() as {
      error: {
        message: string;
      };
    };

  assert.equal(
    response.status,
    400,
  );
  assert.equal(
    body.error.message,
    "Voice session request rejected",
  );
  assert.equal(
    JSON.stringify(body)
      .includes(
        "internal-provider-detail",
      ),
    false,
  );
});

test("Voice plan public error hides integrity details", async () => {
  const rejectingIntegrity:
    VoiceIntegrity = {
      ...integrity,
      async verifySessionReceipt() {
        throw new Error(
          "internal-integrity-detail",
        );
      },
    };

  const api =
    new VoicePlanHttpApi({
      integrity:
        rejectingIntegrity,
      gateway: {
        async operatorContext() {
          return operator();
        },
        async openFromSignal() {
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
                "CASE-ERR-1",
              subjectId:
                "subject-demo",
              locale:
                "ja-JP",
              transcript: {
                provider:
                  "assemblyai",
                transcriptId:
                  "session-error:1",
                text:
                  "synthetic transcript",
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

  const body =
    await response.json() as {
      error: {
        message: string;
      };
    };

  assert.equal(
    response.status,
    400,
  );
  assert.equal(
    body.error.message,
    "Voice plan request rejected",
  );
  assert.equal(
    JSON.stringify(body)
      .includes(
        "internal-integrity-detail",
      ),
    false,
  );
});

test("Communication public error hides Draft verification details", async () => {
  const rejectingIntegrity:
    VoiceIntegrity = {
      ...integrity,
      async verifyCommunicationDraft() {
        throw new Error(
          "internal-draft-detail",
        );
      },
    };

  const api =
    new VoiceCommunicationHttpApi({
      gateway: {
        async operatorContext() {
          return operator();
        },
        async get() {
          throw new Error(
            "must not read Case",
          );
        },
      },
      integrity:
        rejectingIntegrity,
      outbox: {
        async enqueue() {
          throw new Error(
            "must not enqueue",
          );
        },
        async claim() {
          return [];
        },
        async complete() {
          return true;
        },
        async fail() {
          return {
            ok: true,
            status:
              "failed",
          };
        },
      },
    });

  const response =
    await api.handle(
      new Request(
        "https://care.example.test/api/care-ops/tenants/tenant-demo/voice/communications/approve",
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
              draft: {
                id:
                  "CASE-1:family:1",
                caseId:
                  "CASE-1",
                audience:
                  "family",
                channel:
                  "message",
                body:
                  "Synthetic update",
                requiresHumanApproval:
                  true,
                integrity: {
                  version:
                    "hmac-sha256-v1",
                  signature:
                    "a".repeat(43),
                  caseVersion:
                    1,
                  issuedAt:
                    "2026-09-28T12:00:00Z",
                  expiresAt:
                    "2026-09-28T12:15:00Z",
                },
              },
            }),
        },
      ),
    );

  const body =
    await response.json() as {
      error: {
        message: string;
      };
    };

  assert.equal(
    response.status,
    400,
  );
  assert.equal(
    body.error.message,
    "Communication approval rejected",
  );
  assert.equal(
    JSON.stringify(body)
      .includes(
        "internal-draft-detail",
      ),
    false,
  );
});
