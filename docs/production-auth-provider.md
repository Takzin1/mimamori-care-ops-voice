# Production Auth Provider Wiring

The repository contains a dependency-free reference bridge from Supabase Auth to the existing Care Ops browser session boundary.

## Boundary

```text
Supabase Auth SDK
  -> SupabaseBrowserAuthSessionProvider
  -> CareOpsSessionController
  -> CareOpsHttpClient
  -> Care Ops HTTP API
```

Care Ops does not own browser token persistence.

## Reference adapter

Use:

```
SupabaseBrowserAuthSessionProvider
```

with an injected object implementing the minimal `SupabaseBrowserAuthClientLike` contract.

A deployment may pass `supabase.auth` through a small adapter if the installed SDK shape differs.

## What the bridge reads

The bridge reads only:

- current SDK session
- access token for the immediate API call
- optional session expiry
- Auth state-change events

It does not derive:

- tenant
- Care Ops role
- actor ID
- principal authorization

Those remain server-side membership responsibilities.

## Token rule

`accessToken()` asks the Auth SDK for the current session each time.

The Care Ops provider object does not cache or persist the token.

The SDK/deployment may choose its own persistence strategy, but that configuration must be reviewed separately before production.

## Auth state

SDK events map to safe Care Ops states:

```
session present -> authenticated
session absent  -> signed_out
```

Only safe expiry metadata crosses the provider boundary.

The access token itself is not included in UI/session snapshots.

## Sign-out

Care Ops delegates sign-out to the Auth SDK.

If SDK sign-out fails, the provider throws and the session controller does not pretend logout succeeded.

## Deployment still required

This reference bridge does not create:

- a Supabase project
- OAuth providers
- passwordless/email login policy
- MFA policy
- redirect URLs
- session lifetime policy
- refresh-token policy
- production secrets
- login UI

Those are deployment decisions.

## Production checklist

Before enabling real operator login:

1. provision the Auth project/environment
2. define allowed sign-in mechanism
3. define operator onboarding/offboarding ownership
4. review SDK persistence configuration
5. configure redirect/origin policy
6. verify token expiry and refresh behavior
7. verify sign-out behavior
8. verify disabled/deactivated Care Ops membership fails even with a valid Auth session
9. verify user-editable metadata cannot grant Care Ops roles
10. perform the dedicated security audit
