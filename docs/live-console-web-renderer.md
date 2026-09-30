# Live Console Web Renderer

`LiveConsoleWebRenderer` is a zero-runtime-dependency browser renderer for the GK / Last-mile Console.

## Mount boundary

Construct a `LiveConsoleWorkspace`, then pass it to the renderer:

```ts
const renderer = new LiveConsoleWebRenderer({
  root,
  workspace,
})

await renderer.start()
```

The renderer subscribes to workspace snapshots and redraws from safe operational state.

## Visible surfaces

- session state
- operator actor/roles
- Queue summary
- server-ordered Case cards
- SLA breach indicator
- selected Case state
- owner / handoff target
- TTC-supporting metrics
- event timeline
- historical-Case indicator
- server-projected actions
- stale-version conflict warning
- safe command errors

## Action forms

Only actions returned by Case capabilities are shown.

Fields are generated from `requires`:

- `priority`
- `assigneeId`
- `targetAssigneeId`
- `outcome`
- `summary`
- `evidence`
- `reason`

The v0 completion form records one explicit evidence item.

## Security boundary

The renderer does not:

- access tokens
- call fetch directly
- access Auth SDKs
- know principal IDs
- read/write browser persistence
- interpolate dynamic HTML

Deployment/authentication remains outside this renderer.
