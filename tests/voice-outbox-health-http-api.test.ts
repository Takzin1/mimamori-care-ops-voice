import test from "node:test";
import assert from "node:assert/strict";

import {
  VoiceOutboxHealthHttpApi,
} from "../src/http/voice-outbox-health-http-api.ts";

test("Voice outbox health is authenticated, tenant-scoped and payload-free", async () => {
  let seenTenant:
    string | null = null;
  let includeDelivered:
    boolean | undefined;

  const api =
    new VoiceOutboxHealthHttpApi({
      gateway: {
        async operatorContext(
          input,
        ) {
          assert.equal(
            input.accessToken,
            "user-token",
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
      monitor: {
        async snapshot(
          tenantId,
          options,
        ) {
          seenTenant =
            tenantId;
          includeDelivered =
            options
              ?.includeDelivered;

          return {
            tenantId,
            evaluatedAt:
              "2026-09-29T06:00:00Z",
            counts: {
              pending: 2,
              processing: 1,
              failed: 0,
              deadLetter: 0,
              delivered: 7,
            },
            oldestActionableAt:
              "2026-09-29T05:59:00Z",
            oldestDeadLetterAt:
              null,
            maxAttemptCount: 1,
          };
        },
      },
    });

  const response =
    await api.handle(
      new Request(
        "https://care.example.test/api/care-ops/tenants/tenant-demo/voice/outbox/health",
        {
          headers: {
            authorization:
              "Bearer user-token",
          },
        },
      ),
    );

  assert.equal(
    response.status,
    200,
  );
  assert.equal(
    seenTenant,
    "tenant-demo",
  );
  assert.equal(
    includeDelivered,
    true,
  );

  const body =
    await response.json();

  assert.deepEqual(
    body,
    {
      outbox: {
        evaluatedAt:
          "2026-09-29T06:00:00Z",
        counts: {
          pending: 2,
          processing: 1,
          failed: 0,
          deadLetter: 0,
          delivered: 7,
        },
        oldestActionableAt:
          "2026-09-29T05:59:00Z",
        maxAttemptCount: 1,
      },
    },
  );

  const serialized =
    JSON.stringify(body);

  for (
    const forbidden of [
      "payload",
      "deliveryKey",
      "body",
      "caseId",
      "subjectId",
      "approvedBy",
      "serviceRole",
    ]
  ) {
    assert.equal(
      serialized.includes(
        forbidden,
      ),
      false,
    );
  }
});

test("Voice outbox health requires bearer auth before monitor access", async () => {
  let called = false;

  const api =
    new VoiceOutboxHealthHttpApi({
      gateway: {
        async operatorContext() {
          called = true;
          throw new Error(
            "unexpected",
          );
        },
      },
      monitor: {
        async snapshot() {
          called = true;
          throw new Error(
            "unexpected",
          );
        },
      },
    });

  const response =
    await api.handle(
      new Request(
        "https://care.example.test/api/care-ops/tenants/tenant-demo/voice/outbox/health",
      ),
    );

  assert.equal(
    response.status,
    401,
  );
  assert.equal(
    called,
    false,
  );
});
