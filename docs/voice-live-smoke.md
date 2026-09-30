# Voice live smoke test

Run this only against a deployed Voice-enabled Care Ops environment.

Required environment variables:

- `CARE_OPS_API_BASE`
- `CARE_OPS_TENANT_ID`
- `CARE_OPS_ACCESS_TOKEN`

Optional:

- `CARE_OPS_VOICE_LOCALE` (defaults to `ja-JP`)

Command:

```sh
npm run voice:smoke
```

The script requests a short-lived Voice session and validates the returned AssemblyAI WSS session contract.

It does **not** print the Care Ops bearer token or the short-lived AssemblyAI token. Output is limited to provider name, websocket host, sample rate, encoding, and expiry.

A successful smoke check verifies the server-side token/session boundary only. The browser Live Demo must still be used to verify microphone capture, realtime transcription, final Turn handling, Case creation, SOP rendering, and human-approved Outbox enqueue.


## Protected Vercel Preview

If Vercel Deployment Protection is enabled, set the automation bypass secret only in the shell or GitHub Actions secret store:

```sh
export VERCEL_AUTOMATION_BYPASS_SECRET=...
```

Both `voice:probe` and `voice:smoke` send it only as the `x-vercel-protection-bypass` request header to the Care Ops Preview origin. It is never logged and is never sent to AssemblyAI.

## Synthetic backend E2E

After the session smoke succeeds:

```sh
npm run voice:e2e
```

The E2E command uses a synthetic transcript to verify the deployed backend path:

`final transcript → Voice plan → persisted Case → SOP guidance → communication drafts → explicit approval → durable Outbox enqueue`

It does not use microphone audio and therefore does not replace the final browser microphone test.

For GitHub Actions, run the manual **Voice Preview Live Gate** workflow with a synthetic tenant. The secret-bearing job does not accept an arbitrary URL input.


## GitHub Actions trusted Preview origin

Configure the protected `voice-preview` GitHub Environment with:

Environment/repository variables:
- `CARE_OPS_PREVIEW_ORIGIN` — trusted `https://*.vercel.app` Preview origin
- `CARE_OPS_SUPABASE_URL` — synthetic Preview project's Supabase origin
- `CARE_OPS_SUPABASE_PUBLISHABLE_KEY` — publishable key used only for synthetic sign-in

Environment secrets:
- `CARE_OPS_PREVIEW_AUTH_EMAIL`
- `CARE_OPS_PREVIEW_AUTH_PASSWORD`
- `VERCEL_AUTOMATION_BYPASS_SECRET`

The workflow validates the trusted Vercel origin, signs in the synthetic Preview user at runtime, and writes the fresh short-lived bearer only to the job's `GITHUB_ENV`. A long-lived `CARE_OPS_PREVIEW_ACCESS_TOKEN` secret is intentionally not used.
