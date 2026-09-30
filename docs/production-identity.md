# Production Identity Boundary

This document describes the reference server path for authenticated human Care Operations.

## Request path

```text
Browser / operator client
  -> access token
  -> trusted server route
  -> PrincipalAuthenticator
  -> verified principalId
  -> TenantMembershipDirectory
  -> CaseQueueService / CaseService
  -> PostgREST Case Store
```

The browser never supplies the trusted `principalId`.

## Supabase Auth reference

`SupabaseAuthAuthenticator` verifies the bearer token against the Supabase Auth user endpoint.

It returns:

```ts
{
  principalId: user.id,
  provider: "supabase-auth"
}
```

It deliberately ignores email, profile metadata, and `user_metadata` for Care Ops authorization.

## Membership authority

`PostgrestTenantMembershipDirectory` reads:

```
care_tenant_memberships
```

using a trusted server-side service-role key.

A membership binds:

```
tenantId
+ verified principalId
-> actorId
+ roles
+ active
```

The client cannot promote itself by modifying profile metadata.

## Persistent membership schema

The membership table enforces:

- composite primary key: `tenant_id + principal_id`
- unique actor identity inside one tenant
- allowed Care Ops role vocabulary
- RLS enabled
- no PUBLIC / anon / authenticated table access
- service role may SELECT only
- runtime service role cannot INSERT / UPDATE / DELETE memberships

Membership provisioning therefore belongs to an explicit admin workflow rather than normal request handling.

## Authenticated gateway

`AuthenticatedCareOpsGateway` is the intended server facade for human requests.

Supported operations:

- execute Case command
- get Case
- get Case metrics
- get authorized Queue

For each request it authenticates first, then forwards the verified principal into the existing application services.

## Failure ordering

Invalid or expired identity must fail before:

- membership lookup where possible
- Case existence lookup
- Queue listing
- operational mutation

This reduces identity-based Case enumeration and prevents request-body principal spoofing.

## Browser rule

A browser may hold a Supabase publishable key if a future login UI needs it.

A browser must never receive:

- Supabase service-role key
- database service credentials
- a trusted server membership override
- a caller-selectable principalId field in the Care Ops command API

## Still required before production

This boundary is reference infrastructure, not a production launch by itself.

Still required:

- intentionally provisioned Supabase/Auth environment
- login/session UX
- secure server route/cookie/token handling
- membership provisioning/admin workflow
- access revocation/runbook
- token/session expiry policy
- audit of production identity configuration
