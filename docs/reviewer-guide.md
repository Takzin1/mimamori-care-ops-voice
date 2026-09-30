# Reviewer Guide

This guide is for engineers, program reviewers, PoC partners, researchers, and future collaborators evaluating Mimamori Care Ops.

## 1. Start with the product boundary

Read:

- `README.md`
- `docs/adr/0001-last-mile-product-boundary.md`

The central claim is not “better monitoring.”

It is:

> once a signal requires human attention, responsibility must remain explicit until support is verifiably completed.

## 2. Inspect the pure Case Core

Read:

- `src/core/types.ts`
- `src/core/case-core.ts`
- `tests/case-core.test.ts`

Look for:

- strict transition ordering
- current-assignee enforcement
- handoff acceptance
- completion evidence
- reopen behavior
- replay

## 3. Inspect concurrency and persistence

Read:

- `src/persistence/`
- `db/case_store.sql`
- `tests/persistence.test.ts`
- `tests/sql-contract.test.ts`

Key invariants:

- `tenantId + caseId`
- optimistic version check
- Postgres row lock
- snapshot + event append in one transaction
- append-only events

## 4. Inspect authorization

Read:

- `src/access/`
- `docs/adr/0003-tenant-staff-command-authorization.md`
- `tests/application-case-service.test.ts`

Verify that callers do not provide trusted audit actor IDs directly.

## 5. Inspect the end-to-end operational path

The main E2E is in:

`tests/application-case-service.test.ts`

It exercises:

```
Signal
→ NEW
→ ACKNOWLEDGED
→ ASSIGNED
→ IN_PROGRESS
→ HANDOFF_PENDING
→ IN_PROGRESS
→ COMPLETED
→ CLOSED
```

and validates Time to Completion.

## 6. Inspect the Responder Console

Read:

- `docs/responder-console.md`
- `src/presentation/console.ts`
- `demo/responder-console/index.html`
- `docs/reviewer-demo-deployment.md`

The reviewer demo is synthetic-only and intentionally disconnected from production credentials.

A dedicated external reviewer URL is tracked in Issue #22. Until that one-time Vercel project import is complete, use the repository demo locally.

Use it to verify that the visible UI reflects:

- explainable queue order
- explicit responsibility
- handoff acceptance before ownership transfer
- completion evidence
- TTC-oriented metrics

## 7. Know what remains before production

See `docs/project-status.md`, `docs/release-checklist.md`, and Issue #64.

Do not infer production readiness from the strength of the Core invariants. The repository already contains the production identity reference boundary, runtime Postgres adapter, Signal idempotency, SLA engine, live Console renderer, request-admission/origin boundaries, observability hooks, outbox monitoring, and resilience runbooks.

The remaining gates are primarily environment and organizational evidence: provisioned staging/production infrastructure, real provider/secret separation, live Console/Auth deployment, shared/edge admission, observability/alert owners, backup/restore and incident drills, target-operator validation, accessibility review, and privacy/legal/PoC governance.

After staging API + exact Console origin exist, use `npm run preflight:staging` for the credential-free boundary checks.

## 8. Suggested reviewer questions

- Can responsibility disappear during handoff?
- Can a stale client silently overwrite a newer Case?
- Can a caller spoof another staff actor?
- Can one tenant address another tenant’s Case by ID?
- Can a Case be marked complete without evidence?
- Can current state be reconstructed from events?
- Are AI outputs ever treated as accountable human completion?

Those questions map directly to the repository’s design intent.
