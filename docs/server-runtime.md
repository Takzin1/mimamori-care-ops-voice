# Server-only Supabase Care Ops Runtime

The authenticated HTTP API is framework-neutral.

A deployment still needs to compose its trusted server dependencies. The reference composition root is:

```ts
createSupabaseCareOpsRuntime({
  supabaseUrl,
  publishableKey,
  secretKey, // preferred sb_secret_... server credential
  // serviceRoleKey remains a legacy fallback
  slaPolicies,
})
```

The returned runtime intentionally exposes only:

```ts
handle(request: Request): Promise<Response>
```

It does not expose the secret-bearing repository, membership directory, or gateway.

## Composition

```text
SupabaseCareOpsRuntime
  ├─ SupabaseAuthAuthenticator
  ├─ PostgrestTenantMembershipDirectory
  ├─ PostgrestCaseRepository
  ├─ InMemoryTenantSlaPolicyDirectory
  ├─ CaseService
  ├─ CaseQueueService
  ├─ AuthenticatedCareOpsGateway
  └─ CareOpsHttpApi
```

## Credential routing

### Browser/operator access token

The incoming bearer token is forwarded only to the Supabase Auth verification endpoint.

It is not forwarded to:

- Case tables
- membership tables
- service-role RPCs
- outbox storage

### Publishable key

The publishable key identifies the Supabase Auth project for user verification.

It is not treated as a Care Ops authorization role source.

### Server credential

The preferred server credential is a modern `sb_secret_...` key. It is used only by trusted server-side PostgREST adapters and is sent in the `apikey` header only.

Legacy `service_role` JWT credentials remain a compatibility fallback. Only that legacy path uses `Authorization: Bearer <service_role>`.

It must never be sent to:

- browser code
- LIFF
- localStorage
- client cookies
- public environment variables
- synthetic reviewer demo
- Auth bearer verification

The runtime rejects configuration where publishable and service-role credentials are identical.

## SLA policy

The runtime requires at least one explicit tenant SLA policy.

The Core package does not read SLA policy from arbitrary environment variables.

A deployment is responsible for loading reviewed configuration and passing it to the runtime.

## Environment boundary

The runtime does **not** include a generic `process.env` reader.

This is deliberate.

Each deployment adapter should explicitly map its own secret/config provider into the runtime options.

That keeps:

- required values visible
- secret ownership reviewable
- tests deterministic
- framework assumptions outside the Core package

## Framework adapter

A future Next.js/Vercel adapter should be intentionally thin:

```ts
const runtime = createSupabaseCareOpsRuntime(serverConfig)

export async function GET(request: Request) {
  return runtime.handle(request)
}

export async function POST(request: Request) {
  return runtime.handle(request)
}
```

The exact deployment shape may differ, but it must not bypass the runtime's authenticated HTTP boundary.

## Still not production approval

This runtime composition does not by itself provide:

- production secret provisioning
- production Auth project configuration
- rate limiting
- observability
- incident response
- retention/privacy controls
- live Console session UX
- production data approval

Those remain release-gated.
