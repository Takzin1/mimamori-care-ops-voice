# ADR 0015: Dependency-free live Console web renderer

Status: Accepted

Date: 2026-09-26

## Context

The live Console workspace, session coordinator, browser client, authenticated HTTP API, and server-projected capabilities are implemented.

A browser UI is now needed, but introducing a framework or Auth SDK into the Core package would couple the operational model to one deployment stack.

## Decision

Add a dependency-free DOM renderer under `src/console-web/`.

The renderer depends only on:

```
LiveConsoleWorkspace
+ server-projected operator/capability state
```

It does not depend on:

- React
- Next.js
- Supabase SDK
- direct fetch
- browser credential storage
- service-role concepts

A future Next.js application may host this renderer or implement an equivalent thin renderer over the same workspace contract.

## Rendering rule

All dynamic values are written through DOM node properties such as:

- `textContent`
- `value`
- `replaceChildren`

Dynamic HTML insertion APIs are forbidden.

## Action rule

The renderer does not decide which commands are available.

It renders only commands present in the server capability projection.

Input controls are generated from each command's server-projected `requires` list.

Form values are converted into strict `CaseCommandIntent` objects before being sent to the workspace.

## Queue rule

Queue cards are rendered in the order received from the server projection.

The renderer does not sort or score Cases.

## Session rule

The renderer receives no bearer token and no Auth provider.

It uses only workspace operations:

- initialize
- refresh
- select
- execute
- clear selection
- sign out

## v0 target input

Assignment and handoff target use actor-ID text input.

A safe responder directory/picker is a separate future capability and is not inferred by the browser.

## Security

Renderer source must not reference:

- innerHTML / outerHTML / insertAdjacentHTML
- localStorage / sessionStorage / IndexedDB / cookies
- fetch
- Supabase
- service-role credentials
- principalId

## Consequences

- operational UI becomes externally reviewable without changing Core
- renderer remains replaceable
- framework adoption can happen later without moving business rules into components
- server capabilities remain the single source for visible actions
