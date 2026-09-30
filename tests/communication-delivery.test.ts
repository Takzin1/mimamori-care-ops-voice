import test from "node:test";
import assert from "node:assert/strict";

import {
  ApprovedCommunicationOutboxHandler,
  COMMUNICATION_OUTBOX_TOPIC,
} from "../src/voice/index.ts";

function outbox(
  payload: unknown,
) {
  return {
    id: 1,
    tenantId:
      "tenant-demo",
    topic:
      COMMUNICATION_OUTBOX_TOPIC,
    deliveryKey:
      "voice-communication:CASE-1:family:1",
    payload,
    status:
      "processing",
    attemptCount: 1,
    maxAttempts: 8,
    availableAt:
      "2026-09-29T02:00:00Z",
    claimedAt:
      "2026-09-29T02:00:00Z",
    leaseUntil:
      "2026-09-29T02:01:00Z",
    workerId:
      "worker-demo",
  } as const;
}

test("approved communication outbox handler sends only approval-bearing payload", async () => {
  const sent: unknown[] =
    [];

  const handler =
    new ApprovedCommunicationOutboxHandler({
      async send(input) {
        sent.push(input);
      },
    });

  await handler.deliver(
    outbox({
      caseId:
        "CASE-1",
      audience:
        "family",
      channel:
        "message",
      body:
        "Synthetic family update",
      approvedBy:
        "responder-demo",
      approvedAt:
        "2026-09-29T02:00:00Z",
    }),
  );

  assert.equal(
    sent.length,
    1,
  );

  assert.deepEqual(
    sent[0],
    {
      tenantId:
        "tenant-demo",
      deliveryKey:
        "voice-communication:CASE-1:family:1",
      caseId:
        "CASE-1",
      audience:
        "family",
      channel:
        "message",
      body:
        "Synthetic family update",
      approvedBy:
        "responder-demo",
      approvedAt:
        "2026-09-29T02:00:00Z",
    },
  );
});

test("communication outbox handler rejects payload without explicit approval metadata", async () => {
  const handler =
    new ApprovedCommunicationOutboxHandler({
      async send() {
        throw new Error(
          "must not send",
        );
      },
    });

  await assert.rejects(
    () =>
      handler.deliver(
        outbox({
          caseId:
            "CASE-1",
          audience:
            "family",
          channel:
            "message",
          body:
            "Synthetic family update",
        }),
      ),
    /unexpected or missing fields/,
  );
});
