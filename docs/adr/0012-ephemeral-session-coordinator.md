# ADR 0012: Ephemeral browser session coordinator

Status: Accepted

Date: 2026-09-26

## Context

The browser-safe Care Ops HTTP client intentionally does not own login, token persistence, refresh, revocation, or sign-out.

A live Responder Console still needs a small session boundary that tells the UI whether authenticated Care Ops calls are currently allowed and how authentication failure affects subsequent work.

The session layer must not become a second credential store.

## Decision

Add a provider-neutral `CareOpsSessionController`.

The controller receives a `BrowserAuthSessionProvider` and owns the browser-safe `CareOpsHttpClient`.

The provider remains responsible for the actual authentication mechanism and token lifecycle.

The controller stores only safe coordination state:

```
signed_out
ready
reauthentication_required
```

plus optional expiry metadata and a monotonically increasing UI generation.

It never stores an access token or refresh token.

## Token invariant

Every API operation requests a token from the provider at the moment the HTTP client needs it.

The token is passed directly into the existing Authorization-header path.

The controller does not:

- cache a token
- serialize a token
- persist a token
- read or write localStorage
- read or write sessionStorage
- read or write cookies
- own token refresh logic

## Authentication failure

An HTTP 401 moves the controller into:

```
reauthentication_required
```

Subsequent Care Ops calls are rejected until the provider reports a new authenticated state.

The controller does not automatically replay the failed request.

This is especially important for Case mutations: after reauthentication, the operator must explicitly retry from current UI state so optimistic version checks remain visible.

## Authorization and business errors

HTTP 403 does not sign the operator out.

HTTP 409 and 422 remain ordinary operational/business errors.

Only authentication failure changes the session state.

## Provider events

The provider may emit:

- authenticated
- signed_out

An authenticated event restores the controller to `ready`.

A signed-out event moves the controller to `signed_out`.

The controller exposes safe UI subscriptions but not raw token state.

## Sign-out

`signOut()` delegates actual provider logout/revocation behavior to the provider.

The controller marks itself signed out only after provider sign-out completes.

## Disposal

A disposed controller unsubscribes from provider events, clears UI listeners, and rejects further use.

## Consequences

- Console components receive a small safe session model
- token persistence remains outside Care Ops Core
- provider-specific Auth SDKs remain replaceable
- 401 handling is consistent across Queue, detail, metrics, and commands
- mutation retry remains explicit and auditable
