# Vercel Preview deployment

This adapter is intentionally **Preview-only**.

If `VERCEL_ENV=production`, the Care Ops function returns a configuration error until production-grade request admission is explicitly introduced.

## Project

Create a separate Vercel project for this repository.

Recommended project name:

`mimamori-care-ops`

Do not reuse `mimamori-kun` or `mimamori-platform`.

## Git branch

Use:

`feat/assemblyai-voice-ops`

The Vercel Git integration will create a Preview Deployment for the branch.

## Preview environment variables

Set the following **Preview-only** server variables:

- `ASSEMBLYAI_API_KEY`
- `CARE_OPS_VOICE_INTEGRITY_SECRET`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (preferred `sb_secret_...` server credential)
- `CARE_OPS_SLA_POLICIES_JSON`

Legacy compatibility fallback:

- `SUPABASE_SERVICE_ROLE_KEY` (legacy JWT-based service role only)

Optional:

- `CARE_OPS_OUTBOUND_TIMEOUT_MS`
- `CARE_OPS_MAX_COMMAND_BODY_BYTES`

Do not prefix secrets with `NEXT_PUBLIC_` or otherwise expose them to the browser.

The adapter derives `CARE_OPS_CONSOLE_ORIGINS` from the Vercel deployment's own request origin, so each Preview URL remains same-origin without storing a branch-specific URL ahead of the first deployment.

## Routes

The root page serves the Voice Ops demo.

`/`

Care Ops requests are rewritten into one Vercel Function while preserving the original Care Ops path.

Examples:

- `/api/care-ops/tenants/:tenantId/voice/session`
- `/api/care-ops/tenants/:tenantId/voice/plan`
- `/api/care-ops/tenants/:tenantId/voice/communications/approve`

## First verification

After Preview is READY:

1. open the root page;
2. confirm Synthetic mode loads;
3. run `npm run voice:smoke` against the Preview URL;
4. use a synthetic Supabase user/token and synthetic tenant;
5. test microphone → AssemblyAI → final Turn;
6. confirm a real Care Ops Case is persisted;
7. confirm Human approval produces a durable Outbox message.

Do not use real resident or care data.

## Production

Do **not** promote this Preview to Production yet.

Production requires a real shared/edge request admission implementation and explicit production origin/provider configuration.


## Git integration status

Vercel Git integration is connected for `Takzin1/mimamori-care-ops`.

The Vercel Preview adapter was verified by GitHub Actions CI #144 before the first feature-branch Preview deployment trigger.


## Preview configuration preflight

Before using a Care Ops access token, verify that the deployed Preview contains the expected Voice Demo and that all required server-side configuration is present:

```sh
CARE_OPS_API_BASE=https://<preview-host> npm run voice:probe
```

The probe does not use or print a Care Ops access token. It is a configuration preflight and checks only:

- the root page is the Mimamori Ops Voice demo;
- `GET /api/health` reports Preview mode;
- all required server-side Voice configuration is present.

The health endpoint never reports Production as configured. It is not a dependency-readiness signal.


## Voice integrity secret

Preview requires `CARE_OPS_VOICE_INTEGRITY_SECRET`.

Use a randomly generated, server-only value of at least 32 non-whitespace characters. Do not reuse the AssemblyAI or Supabase credentials.

It protects two separate boundaries:

- signed Voice session receipts binding tenant / actor / Case / subject / session / timing;
- signed communication Drafts binding canonical Case version plus a short expiry, preventing browser-side Case, audience, channel, message-body, or stale-state replay tampering.

The browser never receives this secret.

## Health semantics

`GET /api/health` is a **configuration-presence check only** and reports:

```json
{"scope":"configuration-only"}
```

It does not prove Supabase connectivity or AssemblyAI token issuance. Operational verification remains:

`voice:probe → voice:smoke → voice:e2e → browser microphone`


## Supabase server credential routing

Preview prefers `SUPABASE_SECRET_KEY` using the modern `sb_secret_...` format. When present, Care Ops sends that credential only in the Supabase `apikey` header and never in `Authorization`.

`SUPABASE_SERVICE_ROLE_KEY` remains a temporary compatibility fallback for legacy JWT-based projects. In that fallback mode only, the runtime preserves the historical `Authorization: Bearer <service_role>` behavior required by legacy PostgREST access.

When both variables are configured, `SUPABASE_SECRET_KEY` wins. Do not place an `sb_secret_...` value in `SUPABASE_SERVICE_ROLE_KEY`.
