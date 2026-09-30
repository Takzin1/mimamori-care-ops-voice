# ADR 0002: Tenant-scoped persistence

Status: Accepted

Date: 2026-09-25

## Context

The Last-mile Core is intended for multiple provider organizations such as home-care, visiting medical, supportive housing, and public-sector operators.

Using `caseId` as a global authorization or persistence boundary would allow accidental cross-organization reads and writes.

## Decision

Every Case is born with an immutable `tenantId`.

Persistence addresses Cases by the composite boundary:

```
tenantId + caseId
```

The persistence contract must atomically advance both:

1. the current Case snapshot
2. the append-only Case event stream

using compare-and-set semantics on Case `version`.

## Consequences

- identical case IDs may safely exist in different tenants
- a stale write must fail instead of overwriting a newer Case
- event append and snapshot advance must commit together
- database adapters must enforce the same tenant boundary server-side
- changing tenant ownership is not a field update; it requires an explicit transfer workflow
