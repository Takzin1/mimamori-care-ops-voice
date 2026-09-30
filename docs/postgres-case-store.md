# Postgres Case Store

`db/case_store.sql` maps the in-memory persistence contract to Postgres/Supabase semantics.

## Tables

### `care_cases`

Current materialized Case snapshot, keyed by:

```
tenant_id + case_id
```

Operational query columns such as status, priority, assignee, completion timestamps, and source type are indexed separately while the full aggregate is retained in `snapshot`.

Priority is mutable operational state and is persisted on every authorized `priority_changed` transition. Signal lineage remains immutable.

Signal creation is idempotent on:

```
tenant_id + source_adapter + source_signal_id
```

`create_care_case()` uses that database uniqueness boundary so concurrent upstream retries converge to one Case. A compatible retry returns the existing Case with `created: false`; a changed subject/type under the same Signal identity returns a replay mismatch.

### `care_case_events`

Append-only event stream keyed by:

```
tenant_id + case_id + sequence
```

The full event is retained in `event`, with event type, actor, time, and data duplicated into queryable columns.

## Atomic write path

Application code does not perform:

```
UPDATE case
then
INSERT event
```

as separate calls.

It calls `append_care_case_event()`, which:

1. locks the Case row with `FOR UPDATE`
2. compares `expectedVersion`
3. validates next snapshot/event sequence
4. updates the Case snapshot
5. appends the event
6. commits both together

Any statement failure rolls back both writes.

Case origin lineage (`tenant / case / subject / source type / source adapter / source signal / created time`) is immutable after creation and is validated by the append RPC.

## Access model

- RLS enabled on Case, event, and outbox tables
- `anon` and `authenticated` have no direct table access
- runtime `service_role` has SELECT-only table access
- runtime `service_role` cannot directly INSERT/UPDATE/DELETE Case, event, or outbox rows
- RPC execute is revoked from PUBLIC, anon, and authenticated
- only server-side `service_role` is granted runtime mutation RPC execution
- runtime mutation RPCs are `SECURITY DEFINER` with `search_path = pg_catalog`
- application tables are referenced with explicit `public.` qualification inside those RPCs

This keeps structural writes behind the compare-and-set / append / lease RPC contracts even if another trusted server component accidentally attempts direct table DML.

The function owner is therefore part of the migration trust boundary and must remain a database owner capable of the intended writes.

## Deployment state

This SQL is a reference persistence contract and has **not** yet been applied to a new Mimamori Care Ops Supabase project.
