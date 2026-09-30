# Browser Session Boundary

`CareOpsSessionController` is the session coordination layer between a live Console and `CareOpsHttpClient`.

## Architecture

```text
Console UI
  -> CareOpsSessionController
       -> BrowserAuthSessionProvider
       -> CareOpsHttpClient
  -> authenticated Care Ops HTTP API
```

The controller is provider-neutral.

A deployment may implement `BrowserAuthSessionProvider` with Supabase Auth or another identity provider.

## Safe session state

The controller exposes only:

- `signed_out`
- `ready`
- `reauthentication_required`
- safe expiry metadata
- generation number for UI refresh

It does not expose or retain bearer tokens.

## Provider contract

A provider supplies:

```ts
interface BrowserAuthSessionProvider {
  currentStatus(): BrowserAuthSessionStatus | Promise<BrowserAuthSessionStatus>
  accessToken(): string | null | Promise<string | null>
  signOut(): void | Promise<void>
  subscribe(listener): () => void
}
```

The provider owns:

- login
- refresh / rotation
- token expiry handling
- underlying SDK/session storage choices
- provider logout/revocation

Care Ops owns only the operational session state seen by the Console.

## API calls

The controller implements the same Care Ops client operations:

- queue
- Case detail
- metrics
- commands

For every operation:

1. require `ready`
2. ask the provider for a current access token
3. let `CareOpsHttpClient` send the request
4. preserve all normal HTTP/business errors
5. convert only HTTP 401 into a session-state transition

## No automatic mutation replay

A command that receives 401 is not automatically repeated after reauthentication.

The operator/UI must fetch current state if needed and submit the intended action again.

This prevents hidden duplicate mutations and keeps optimistic concurrency visible.

## Browser persistence rule

The Care Ops session controller must not reference:

- localStorage
- sessionStorage
- IndexedDB
- document.cookie

Provider-specific session persistence remains deployment code and requires its own review.

## Still required for a live Console

This module is not a login screen.

A live application still needs:

- a reviewed Auth provider integration
- sign-in UX
- provider-specific refresh/rotation behavior
- tenant selection/navigation
- Console components that bind Queue/detail/actions to this controller
- deployment CORS/origin policy
