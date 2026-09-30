# ADR 0016: RPC-only runtime database mutation

Status: Accepted

Date: 2026-09-26

## Context

The Care Ops runtime uses a server-side Supabase/PostgREST service-role credential.

The application adapters already mutate Cases and outbox rows through transactional RPCs, but the database role also had direct table INSERT/UPDATE privileges.

That meant another trusted server component, or a compromised runtime credential, could bypass structural invariants enforced by the RPC path:

- compare-and-set Case version
- immutable Signal lineage
- snapshot + event atomicity
- automatic Case-event outbox enqueue
- outbox lease/worker transition rules

This was not a browser authentication bypass, but it unnecessarily increased audit-integrity blast radius.

## Decision

Runtime persistence tables are read-only to `service_role`.

Mutations are allowed only through the approved runtime RPCs:

- `create_care_case`
- `append_care_case_event`
- `enqueue_care_outbox`
- `claim_care_outbox`
- `complete_care_outbox`
- `fail_care_outbox`

The runtime role receives:

- SELECT on persistence tables
- EXECUTE on the approved RPCs

It does not receive:

- table INSERT
- table UPDATE
- table DELETE
- direct outbox sequence usage

## SECURITY DEFINER boundary

The mutation RPCs run as `SECURITY DEFINER` so the read-only runtime role can request approved state transitions without receiving direct table DML.

Each function:

- fixes `search_path` to `pg_catalog`
- references application tables through explicit `public.` qualification
- is not executable by PUBLIC, anon, or authenticated
- remains callable only from the trusted server-side runtime role

The migration/function owner is therefore part of the trusted database administration boundary.

## What this does not protect against

Possession of the trusted runtime credential still permits calls to the approved RPCs.

Application authorization remains responsible for binding a verified principal to an allowed business command before an RPC is invoked.

This ADR narrows structural write authority; it does not replace application-layer authentication or authorization.

## Consequences

- direct PostgREST DML cannot bypass Case/event/outbox structural rules
- event append remains coupled to snapshot advancement
- runtime credential blast radius is reduced
- real PostgreSQL CI must prove direct DML fails while approved RPCs continue to succeed
- future persistence write paths require an explicit RPC and review
