# Runtime Postgres / Supabase Adapter

`PostgrestCaseRepository` is the production-facing `CaseRepository` adapter for a Supabase/PostgREST deployment of `db/case_store.sql`.

## Boundary

The adapter translates the application repository contract into:

- `create_care_case()` RPC for retry-safe creation
- `append_care_case_event()` RPC for compare-and-set event append
- tenant-scoped PostgREST reads for snapshots and event streams

The pure Core does not depend on Supabase or PostgREST.

## Server-side only

The adapter requires a **service-role key**.

It must run only in a trusted server environment.

Never expose the service-role key to:

- LIFF
- browser JavaScript
- mobile client bundles
- public environment variables
- screenshots or logs

Client applications should call a trusted application/API boundary, which then uses this repository.

## Integrity checks on read

The adapter does not trust the materialized snapshot alone.

For each loaded Case it:

1. loads the current snapshot
2. loads the ordered append-only event stream
3. replays the events through the TypeScript Case Core
4. compares replayed state with the stored snapshot
5. fails closed with `CASE_STORE_CORRUPTION` on divergence

This turns the repository adapter into an integrity boundary rather than a passive JSON mapper.

## Write behavior

### Create

The adapter derives the initial aggregate from `case_created`, then invokes `create_care_case()`.

The database remains the final idempotency boundary for:

```
tenantId + sourceAdapter + sourceSignalId
```

A compatible retry resolves to the existing Case. A replay mismatch is mapped to `SIGNAL_REPLAY_MISMATCH`.

### Append

The adapter:

1. loads and replay-validates the current Case
2. checks local expected version
3. applies the event with the pure Core
4. sends the next snapshot + event to `append_care_case_event()`
5. maps database not-found / conflict results back to domain errors

A race between step 1 and step 4 is still safe because the database RPC performs the authoritative `FOR UPDATE` + expected-version check.

## Pagination

Tenant list reads are paginated instead of assuming PostgREST's default row limit.

Current default page size: 500.

## Real Postgres CI

CI runs a PostgreSQL 17 service and applies:

1. `tests/postgres/bootstrap.sql`
2. `db/case_store.sql`
3. `tests/postgres-real.integration.test.ts`

The integration test verifies:

- Signal retry idempotency
- stale-write conflict behavior
- transaction rollback when event append fails after snapshot update begins
- event-stream replay equals stored snapshot
- service role cannot UPDATE append-only event rows

No paid Supabase project is created by CI.
