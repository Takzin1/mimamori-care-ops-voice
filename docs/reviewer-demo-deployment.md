# Reviewer Demo Deployment

The synthetic Responder Console is designed to be deployed as a **dedicated Vercel project**.

Do not deploy it into the legacy `mimamori-kun` or `mimamori-platform` projects.

## One-time import

Import this private GitHub repository into Vercel:

```
Takzin1/mimamori-care-ops
```

Create a new project.

Set **Root Directory** to:

```
demo/responder-console
```

Framework preset:

```
Other / static
```

No build command is required.

No environment variables are required.

## Security posture

`demo/responder-console/vercel.json` applies:

- Content Security Policy
- `connect-src 'none'`
- `form-action 'none'`
- `frame-ancestors 'none'`
- `object-src 'none'`
- no-referrer
- camera / microphone / geolocation disabled

The demo therefore cannot initiate production API traffic even if someone later adds an accidental browser `fetch()` without updating CSP.

## Data posture

The deployment contains synthetic identifiers only.

It must never receive:

- real resident names
- phone numbers
- LINE IDs
- medical/care records
- Supabase keys
- service-role keys
- production evidence

## Reviewer verification

After deployment:

1. open the root URL
2. confirm the red banner says `SYNTHETIC REVIEWER DEMO · NOT PRODUCTION`
3. click through the synthetic lifecycle to `CLOSED`
4. during `HANDOFF_PENDING`, confirm owner remains `responder-a`
5. after acceptance, confirm owner becomes `responder-b`
6. confirm Completion Evidence appears before close
7. confirm the active queue drops the completed/closed scenario
8. confirm browser console has no errors
9. confirm there are no API/XHR/fetch requests
10. record the reviewer URL in `docs/reviewer-guide.md`

## Deployment ownership

This static reviewer project is an external-review artifact.

It is not the production application and must not be promoted into a production care-data environment.

## Current connector limitation

The connected Vercel tool can inspect and deploy existing projects, but it does not expose a create-project mutation.

Therefore the **first project import is a one-time Vercel dashboard action**. After the project exists, subsequent deployments can be inspected and managed through the connected Vercel integration.
