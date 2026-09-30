# Browser-safe Care Ops Client

`CareOpsHttpClient` is the browser-facing transport for a future live Responder Console.

It talks only to the authenticated Care Ops HTTP API.

It does not talk directly to Supabase tables, PostgREST, or the membership store.

## Boundary

```text
Console UI
  -> AccessTokenProvider
  -> CareOpsHttpClient
  -> Care Ops HTTP API
  -> server runtime
```

The client supports:

- operator context
- Queue
- Case detail
- Case capabilities
- Case metrics
- Case commands

## Token ownership

The client accepts:

```ts
type AccessTokenProvider =
  () => string | Promise<string>
```

The provider is called for every API operation.

The client does not persist the returned token.

It does not:

- write localStorage
- write sessionStorage
- write cookies
- refresh tokens
- cache tokens between requests

A future session shell owns login, refresh, rotation, and sign-out semantics.

## Request safety

Every request uses:

- `Authorization: Bearer <token>`
- `credentials: "omit"`
- `cache: "no-store"`
- `redirect: "error"`
- `referrerPolicy: "no-referrer"`

The token is never placed in:

- URL
- query string
- JSON body
- error message

## Command sanitization

The client does not serialize the caller's command object wholesale.

It reconstructs the allowed Case command fields before JSON serialization.

This is defense in depth against code that bypasses TypeScript and adds fields such as `actorId`.

Trusted actor identity still comes from the server-side verified membership path.

## Error model

Safe server error envelopes are converted to `CareOpsHttpClientError` with:

- HTTP status
- stable error code
- safe message
- request ID
- optional structured details

Non-JSON or malformed responses fail closed as `CareOpsHttpProtocolError`.

Raw proxy/database bodies are not surfaced as trusted application errors.

## Base URL

The client accepts an absolute HTTP(S) origin only.

Embedded credentials, subpaths, queries, and fragments are rejected.

## Still required

The client is not a login/session UI.

A live Console still requires a reviewed session shell that provides fresh access tokens without exposing service-role credentials.
