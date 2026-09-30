import test from "node:test";
import assert from "node:assert/strict";

import {
  createAssemblyAiVoiceCareOpsDeployment,
} from "../src/deployment/index.ts";

test("AssemblyAI voice deployment keeps provider credential in server-side issuer composition", async () => {
  let tokenRequestSeen = false;

  const app =
    createAssemblyAiVoiceCareOpsDeployment({
      env: {
        CARE_OPS_ENVIRONMENT:
          "staging",
        SUPABASE_URL:
          "https://project.supabase.test",
        SUPABASE_PUBLISHABLE_KEY:
          "publishable-key",
        SUPABASE_SERVICE_ROLE_KEY:
          "service-role-key",
        CARE_OPS_CONSOLE_ORIGINS:
          "https://care.example.test",
        CARE_OPS_SLA_POLICIES_JSON:
          JSON.stringify({
            "tenant-demo": {
              critical: {
                acknowledgeWithinMs: 1000,
                assignWithinMs: 1000,
                firstActionWithinMs: 1000,
                handoffAcceptWithinMs: 1000,
                completeWithinMs: 1000
              },
              high: {
                acknowledgeWithinMs: 1000,
                assignWithinMs: 1000,
                firstActionWithinMs: 1000,
                handoffAcceptWithinMs: 1000,
                completeWithinMs: 1000
              },
              normal: {
                acknowledgeWithinMs: 1000,
                assignWithinMs: 1000,
                firstActionWithinMs: 1000,
                handoffAcceptWithinMs: 1000,
                completeWithinMs: 1000
              },
              low: {
                acknowledgeWithinMs: 1000,
                assignWithinMs: 1000,
                firstActionWithinMs: 1000,
                handoffAcceptWithinMs: 1000,
                completeWithinMs: 1000
              }
            }
          })
      },
      assemblyAiApiKey:
        "server-secret-key",
      voiceIntegritySecret:
        "voice-integrity-deployment-secret-0123456789",
      admission: {
        async admit() {
          return {
            allowed: true
          };
        }
      },
      fetchImpl:
        async (
          input,
          init = {},
        ) => {
          const url =
            new URL(
              input.toString(),
            );
          const headers =
            new Headers(
              init.headers,
            );

          if (
            url.pathname ===
              "/auth/v1/user"
          ) {
            return new Response(
              JSON.stringify({
                id: "principal-demo"
              }),
              {
                headers: {
                  "content-type":
                    "application/json"
                }
              }
            );
          }

          if (
            url.pathname ===
              "/rest/v1/care_tenant_memberships"
          ) {
            return new Response(
              JSON.stringify([
                {
                  tenant_id:
                    "tenant-demo",
                  principal_id:
                    "principal-demo",
                  actor_id:
                    "responder-demo",
                  roles: [
                    "responder"
                  ],
                  active: true
                }
              ]),
              {
                headers: {
                  "content-type":
                    "application/json"
                }
              }
            );
          }

          throw new Error(
            "unexpected Care Ops fetch"
          );
        },
      assemblyAiFetchImpl:
        async (
          input,
          init = {},
        ) => {
          tokenRequestSeen = true;
          const tokenUrl =
            new URL(
              input.toString(),
            );

          assert.equal(
            tokenUrl.origin +
              tokenUrl.pathname,
            "https://streaming.assemblyai.com/v3/token"
          );
          assert.equal(
            tokenUrl.searchParams.get(
              "expires_in_seconds"
            ),
            "300"
          );
          assert.equal(
            init.method,
            "GET"
          );

          const headers =
            new Headers(
              init.headers
            );

          assert.equal(
            headers.get(
              "authorization"
            ),
            "server-secret-key"
          );

          return new Response(
            JSON.stringify({
              token:
                "short-lived-token"
            }),
            {
              headers: {
                "content-type":
                  "application/json"
              }
            }
          );
        },
      clock:
        () =>
          "2026-09-29T02:00:00Z"
    });

  const response =
    await app.handle(
      new Request(
        "https://care.example.test/api/care-ops/tenants/tenant-demo/voice/session",
        {
          method: "POST",
          headers: {
            authorization:
              "Bearer user-token",
            origin:
              "https://care.example.test",
            "content-type":
              "application/json"
          },
          body:
            JSON.stringify({
              caseId:
                "CASE-VOICE-1",
              subjectId:
                "subject-demo-1",
              locale:
                "ja-JP"
            })
        }
      )
    );

  assert.equal(
    response.status,
    201
  );
  assert.equal(
    tokenRequestSeen,
    true
  );

  const body =
    await response.json() as {
      session: {
        websocketUrl: string;
      };
      evidenceReceipt:
        string;
    };

  assert.ok(
    body.evidenceReceipt.length >
      20,
  );

  const url =
    new URL(
      body.session.websocketUrl
    );

  assert.equal(
    url.searchParams.get(
      "token"
    ),
    "short-lived-token"
  );
});
