import test from "node:test";
import assert from "node:assert/strict";

import {
  WebhookCommunicationSender,
} from "../src/voice/index.ts";

const approved = {
  tenantId:
    "tenant-demo",
  deliveryKey:
    "delivery-1",
  caseId:
    "CASE-1",
  audience:
    "family",
  channel:
    "message",
  body:
    "Synthetic update",
  approvedBy:
    "responder-demo",
  approvedAt:
    "2026-09-29T02:40:00Z",
} as const;

test("webhook communication sender resolves destination server-side and sends idempotently", async () => {
  let called = false;

  const sender =
    new WebhookCommunicationSender({
      resolver: {
        async resolve(input) {
          assert.equal(
            input.tenantId,
            "tenant-demo",
          );
          assert.equal(
            input.audience,
            "family",
          );

          return {
            url:
              "https://delivery.example.test/voice-message",
            headers: {
              authorization:
                "Bearer server-side-secret",
            },
          };
        },
      },
      fetchImpl:
        async (
          input,
          init = {},
        ) => {
          called = true;

          assert.equal(
            String(input),
            "https://delivery.example.test/voice-message",
          );

          const headers =
            new Headers(
              init.headers,
            );

          assert.equal(
            headers.get(
              "authorization",
            ),
            "Bearer server-side-secret",
          );
          assert.equal(
            headers.get(
              "idempotency-key",
            ),
            "delivery-1",
          );

          const body =
            JSON.parse(
              String(
                init.body,
              ),
            );

          assert.equal(
            body.body,
            "Synthetic update",
          );
          assert.equal(
            body.approvedBy,
            "responder-demo",
          );

          return new Response(
            JSON.stringify({
              ok: true,
            }),
            {
              status: 202,
              headers: {
                "content-type":
                  "application/json",
              },
            },
          );
        },
    });

  await sender.send(
    approved,
  );

  assert.equal(
    called,
    true,
  );
});

test("webhook communication sender rejects insecure destination", async () => {
  const sender =
    new WebhookCommunicationSender({
      resolver: {
        async resolve() {
          return {
            url:
              "http://delivery.example.test/voice-message",
          };
        },
      },
      fetchImpl:
        async () => {
          throw new Error(
            "must not fetch",
          );
        },
    });

  await assert.rejects(
    () =>
      sender.send(
        approved,
      ),
    /credential-free HTTPS/,
  );
});
