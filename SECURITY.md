# Security Policy

Mimamori Care Ops is currently an architecture/core prototype and is **not approved for production resident, medical, or care data**.

## Supported security posture

Current work focuses on:

- tenant isolation
- trusted principal-to-actor binding
- role-based Case command authorization
- optimistic concurrency
- append-only operational evidence
- fail-closed Postgres/Supabase access contracts
- synthetic-data-only development

## Do not report sensitive vulnerabilities in a public issue

If you discover a vulnerability that could expose credentials, personal information, cross-tenant data, or allow unauthorized Case mutation:

1. do not open a public issue containing exploit details
2. contact the repository owner through a private GitHub channel / security advisory path available to you
3. include the affected commit, impact, reproduction conditions, and whether real credentials or data were involved

Do not include real resident or patient information in a report.

## High-priority vulnerability classes

Please treat these as security-sensitive:

- cross-tenant Case access
- actor identity spoofing
- privilege escalation
- assignment/handoff to unauthorized principals
- completion without accountable evidence
- stale-write / double-claim corruption
- mutation of historical events
- service-role or secret exposure
- bypass of RLS / RPC access restrictions

## Data handling

Development and demos must use synthetic data only.

Never commit:

- resident names or real identifiers
- phone numbers / LINE user IDs
- medical or care records
- real addresses tied to residents
- production API keys
- Supabase service-role keys
- access or refresh tokens
- screenshots containing personal data

## Production readiness

Before production use, the project still requires at minimum:

- production identity-provider integration
- production database adapter + integration tests
- secret management
- deployment hardening
- observability / incident response
- retention and deletion policy
- privacy / legal review
- operational access review
- backup and recovery tests

See `docs/release-checklist.md`.


## Service-role key boundary

`PostgrestCaseRepository` uses a Supabase/PostgREST service-role key and is **server-side only**.

Never expose that key to LIFF, browser/mobile bundles, public environment variables, screenshots, client logs, or demo payloads.

Clients must call a trusted application/API boundary; only that trusted server boundary may instantiate the production repository adapter.


## Outbox data boundary

Outbox payloads may reference operational Case data and must be treated with the same sensitivity as the originating Case event.

Do not dump full outbox payloads into public logs, CI output, analytics, screenshots, or provider error messages.

Delivery adapters should log stable identifiers and status metadata rather than resident/care content.

Dead-letter items require an operational review path before production use; they must not be silently ignored.


## Production identity boundary

Human Care Ops requests must authenticate before Case/Queue lookup.

Do not trust client-supplied `principalId`, browser session user objects alone, or user-editable profile metadata for tenant authorization.

The reference Supabase path verifies the access token against Auth, then resolves Care Ops actor identity and roles from the server-only tenant membership store.

Runtime service-role access to memberships is read-only. Membership provisioning must use a separate administrative path with explicit authorization.


## Membership administration control plane

Operational Care Ops roles do not grant membership-provisioning authority.

Membership lifecycle changes use a separate database control plane with:

- expected-version conflict detection
- mandatory administrative actor and reason
- delete prohibition; deactivate instead
- one access-control change per version
- append-only audit events
- atomic snapshot + audit behavior

The runtime `service_role` remains SELECT-only for membership data and cannot execute membership mutation functions.

The dedicated `care_membership_admin` database role is NOLOGIN and must not be granted to runtime/browser credentials. The audit trigger function is private, not publicly executable, and exists only to guarantee audit insertion that the admin role itself cannot forge directly.


## HTTP transport boundary

Responder-facing HTTP requests use the trusted `AuthenticatedCareOpsGateway`.

The HTTP transport:

- accepts identity only as a Bearer access token
- never accepts trusted `principalId` or `actorId` from JSON
- strictly rejects unknown command fields
- resolves tenant and Case identifiers from bounded route segments
- returns `Cache-Control: no-store`
- emits no permissive CORS header
- does not expose database/service-role credentials
- maps internal failures to safe response bodies without database details

Cross-tenant access is denied by membership before Case existence is disclosed.


## Server runtime composition

The lower-level trusted server runtime is `createSupabaseCareOpsRuntime`. Production-facing operational wiring should use `createOperationalSupabaseCareOpsRuntime`, which adds health/readiness/observability and requires an explicit request-admission controller.

The runtime intentionally exposes only `handle(request)`.

It does not expose the service-role-bearing Case repository, membership directory, or authenticated gateway.

The incoming user bearer token is routed only to Auth verification. The service-role credential is routed only to server-side PostgREST adapters.

Secret loading remains a deployment responsibility; the Core package does not read generic environment variables.


## Browser client boundary

Browser code may use `CareOpsHttpClient` to call the authenticated Care Ops API.

The client has no service-role configuration and does not access PostgREST directly.

It obtains a bearer token from an injected provider for each request and does not persist or refresh that token.

Requests omit ambient credential cookies, disable caching, reject redirects, and use no-referrer behavior.

Command objects are rebuilt from allowed business fields before serialization so caller-supplied `principalId` or `actorId` cannot become trusted API input.


## Browser session boundary

The Care Ops session controller stores only safe coordination state and must not retain bearer or refresh tokens.

It does not access localStorage, sessionStorage, IndexedDB, or cookies.

A 401 transitions the Console to reauthentication-required state. Failed Case mutations are never automatically replayed after reauthentication.

Provider-specific Auth SDK/session persistence remains deployment code and requires separate review.


## Responder lateral access

Responder visibility is Case-scoped.

An active responder may read Case detail, metrics, and capabilities only when their trusted actor ID matches the current `assigneeId` or `handoffTargetId`.

Dispatcher, supervisor, and auditor read roles remain tenant-wide.

The application performs tenant membership authorization before Case lookup, then applies Case-level responder visibility after loading the tenant-scoped Case. This preserves cross-tenant existence protection while preventing same-tenant lateral reads.

Responders do not acknowledge unassigned NEW Cases in the current lifecycle.


## Runtime database mutation boundary

Runtime `service_role` access to Care Ops persistence tables is read-only.

Case, event, and outbox mutation must pass through the approved persistence RPCs.

Those RPCs use a tightly scoped `SECURITY DEFINER` boundary with:

- fixed `search_path = pg_catalog`
- explicit `public.` table qualification
- execution revoked from PUBLIC / anon / authenticated
- execution granted only to the trusted server-side runtime role

The runtime role cannot directly INSERT/UPDATE/DELETE Case, event, or outbox rows and does not receive direct outbox sequence usage.

This does not make compromise of a trusted runtime credential harmless: the credential can still invoke approved mutation RPCs. The boundary exists to prevent direct SQL/PostgREST writes from bypassing compare-and-set, append-only event sequencing, atomic outbox enqueue, and worker lease rules.

## Operational actor identifiers

Care Ops actor IDs are machine identifiers, not display names.

They use the canonical grammar:

```
^[A-Za-z0-9._:-]{1,128}$
```

The grammar is enforced at HTTP command parsing, membership actor lookup, membership administration, and the persistent membership table.

This prevents assignment/handoff identifiers from introducing PostgREST filter metacharacters or ambiguous whitespace into trusted lookup paths.

Human-readable staff names belong in a separate presentation/profile field and must not be encoded into `actorId`.


## Outbound dependency timeout

Trusted server calls to Supabase Auth and PostgREST are time-bounded.

The reference adapters use one bounded timeout policy:

- default: 10 seconds
- configurable range: 1–60000 ms
- server runtime override: `outboundTimeoutMs`

Covered adapters:

- Supabase Auth verifier
- tenant membership directory
- Case Store repository
- Outbox Store

Timeout or abort is treated as an authentication/transport failure. There is no fail-open fallback.


## Inbound request admission boundary

Production-facing Care Ops traffic must pass a request-admission control before Auth or PostgREST work.

`OperationalSupabaseCareOpsRuntime` requires an injected admission controller and fails construction if it is missing.

Admission semantics:

- allowed -> continue to the authenticated handler
- denied -> stable HTTP 429 `RATE_LIMITED`
- admission backend error / invalid decision -> stable HTTP 503 `ADMISSION_UNAVAILABLE`
- optional `Retry-After` is bounded to 1..3600 seconds
- GET/HEAD health and readiness probes bypass admission

The Core does not trust `X-Forwarded-For` or any other source header by default. Source/key derivation belongs to the deployment adapter, which must use ingress metadata that the platform actually authenticates.

The admission provider must not consume the request body or log bearer tokens/resident/Case payloads.

This boundary does not itself choose a distributed limiter. Production still requires a shared/edge provider, thresholds, monitoring, and abuse-response ownership.


## CI toolchain supply-chain boundary

The repository-managed TypeScript compiler is pinned as an exact devDependency and installed from the committed npm lockfile.

CI uses `npm ci --ignore-scripts` before typecheck, so package.json / lockfile drift fails the build rather than silently resolving a different compiler.

The TypeScript 5.9.2 tarball is protected by the lockfile integrity value:

```
sha512-CWBzXQrc/qOkhidw1OzBTQuYRbfyxDXJMVJ1XNwUHGROVmuaeiEm3OslpZ1RV96d7SKKjZKrSJu3+t/xlw3R9A==
```

CI also runs an explicit dependency audit at high severity.

This complements the existing immutable GitHub Actions commit pins and PostgreSQL image digest.


## Browser origin / CORS boundary

Production-facing Care Ops browser traffic must pass an explicit origin policy before request admission, authentication, or PostgREST work.

The reference production composition requires a browser origin policy and rejects missing configuration.

The provided exact policy accepts only canonical HTTP(S) origins and rejects `null`, wildcard, malformed, path-bearing, credential-bearing, and non-canonical values.

For allowed browser traffic the runtime emits only the exact allowed origin and `Vary: Origin`; it never emits wildcard CORS or `Access-Control-Allow-Credentials`.

Care Ops preflight is limited to GET/POST with Authorization and Content-Type.

Requests without Origin may continue as non-browser/service requests and still require admission/authentication.
