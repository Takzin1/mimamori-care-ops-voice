# External Review Package

This page is the fastest route for an external engineer, program reviewer, PoC partner, or future collaborator to understand Mimamori Care Ops without assuming production readiness.

## One-sentence product boundary

Mimamori Care Ops owns the **last mile from a human-attention signal to verifiable support completion**.

Detection and notification are upstream. The Core begins where accountable human action must be assigned, handed off, completed, and evidenced.

## What this repository demonstrates

The repository currently demonstrates, with automated tests:

- strict Case lifecycle
- no ownership gap during handoff
- evidence-backed support completion
- append-only event history + replay
- tenant-scoped persistence
- optimistic concurrency / stale-write rejection
- Signal retry idempotency
- deterministic SLA / aging evaluation
- authorized, explainable Case Queue projection
- transactional outbox
- payload-free outbox health projection
- Supabase/PostgREST server adapters
- verified-token identity boundary
- persistent tenant membership
- audited membership administration
- authenticated HTTP API
- browser-safe API client
- ephemeral browser session coordination
- Supabase browser Auth reference bridge
- live Console workspace race/conflict handling
- server-projected operator/Case capabilities
- dependency-free safe DOM renderer
- provider-neutral health/readiness + non-PII observability wrapper
- fail-closed request-admission boundary
- strict exact-origin / narrow-CORS browser boundary
- fail-closed staging/production deployment environment parser
- operational Supabase deployment composition root
- secret-safe network-free deployment config doctor
- credential-free synthetic staging boundary preflight
- manual read-only staging evidence workflow
- incident / backup-restore-rollback / outbox operations runbooks
- repository-governance audit for main protection + required CI
- real PostgreSQL integration CI

## What this repository does not demonstrate

It does **not** currently demonstrate a production healthcare/care deployment.

Not yet provisioned, deployed, exercised, or approved:

- production-equivalent Auth environment and live login deployment
- live authenticated Responder Console deployment
- production membership-admin credential/identity
- staging/production infrastructure
- shared/edge request-admission provider and approved thresholds
- production observability providers, alerts, and on-call ownership
- outbox provider credential/delivery validation
- retention / deletion implementation
- backup provider, approved RPO/RTO, and restore/rollback drill evidence
- incident/secret-rotation drill evidence
- target-operator and accessibility validation
- privacy/legal/real-world PoC governance
- real resident/care/medical data

Repository code, validators, evidence templates, and runbooks for several of these gates already exist. Their existence is intentionally **not** treated as proof that a live environment or operational drill has passed.

Real personal or care data is not allowed in this repository or demo environment.

## 10-minute review path

1. [README](../README.md)
2. [Project Status](project-status.md)
3. [Architecture](architecture.md)
4. [ADR 0001 — Last-mile product boundary](adr/0001-last-mile-product-boundary.md)
5. [ADR 0002 — Tenant-scoped persistence](adr/0002-tenant-scoped-persistence.md)
6. [ADR 0006 — Transactional outbox](adr/0006-transactional-outbox.md)
7. [ADR 0007 — Production identity boundary](adr/0007-production-identity-boundary.md)
8. [ADR 0008 — Audited membership control plane](adr/0008-audited-membership-control-plane.md)
9. [ADR 0014 — Server-projected Console capabilities](adr/0014-server-projected-console-capabilities.md)
10. [ADR 0015 — Dependency-free Console renderer](adr/0015-dependency-free-console-renderer.md)

Then inspect:

- `src/core/case-core.ts`
- `src/application/`
- `src/persistence/`
- `src/console/`
- `src/console-web/`
- `db/case_store.sql`
- `db/identity_store.sql`

## Evidence-oriented tests

High-signal tests include:

- `tests/case-core.test.ts`
- `tests/application-case-service.test.ts`
- `tests/identity.test.ts`
- `tests/identity-postgres.integration.test.ts`
- `tests/http-api.test.ts`
- `tests/live-console-workspace.test.ts`
- `tests/console-capabilities.test.ts`
- `tests/console-web.test.ts`
- `tests/deployment-composition.test.ts`
- `tests/deployment-config-doctor.test.ts`
- `tests/deployment-config-cli.test.ts`
- `tests/staging-preflight.test.ts`
- `tests/staging-preflight-workflow.test.ts`
- `tests/repository-governance.test.ts`
- `tests/repository-governance-workflow.test.ts`
- `tests/postgres-real.integration.test.ts`

## CI

The GitHub Actions workflow runs two independent jobs:

- `verify`
- `postgres-integration`

The second job runs against a real PostgreSQL 17 service.

Passing unit tests alone is not treated as sufficient evidence for persistence/security changes.

## Demo boundary

The synthetic reviewer demo under:

```
demo/responder-console/
```

is intentionally disconnected from production identity and real data.

It demonstrates the operational model only.

The live Console renderer under `src/console-web/` is a separate capability and is not a production deployment by itself.

## Security review boundary

Reviewers should pay particular attention to:

- cross-tenant access
- caller-controlled actor spoofing
- stale-write handling
- handoff ownership gaps
- completion without evidence
- event-history mutation
- service-role exposure
- membership privilege escalation
- token persistence in browser layers
- command replay after authentication or conflict failure

See [SECURITY.md](../SECURITY.md).

## Current repository-governance gap

The codebase uses PRs and CI by convention. GitHub was checked on 2026-09-26 and currently reports:

- `main protected: false`
- branch protection disabled
- required status checks off
- no repository rulesets

Recommended settings are documented in [Repository Governance](repository-governance.md). After configuration, the manual **Repository Governance Audit** workflow verifies that `verify` and `postgres-integration` are enforced.

Until that setting is enabled, passing CI is a project convention rather than a GitHub-enforced merge gate.


## Operations review

Before production review, also read:

- [Incident Response](incident-response.md)
- [Backup, Restore, and Rollback](backup-restore-rollback.md)
- [Outbox and Dead-Letter Operations](outbox-operations.md)
- [Deployment Environment Contract](deployment-environment.md)

These are repository-level runbooks. Their production owners, thresholds, credentials, provider configuration, and drill evidence are intentionally not claimed as complete.

Before provisioning a synthetic staging runtime, the repository also provides:

```bash
npm run config:validate
```

to validate the deployment configuration without network access or credential echoing. After the staging API and exact Console origin exist, use the credential-free **Staging Preflight** workflow/CLI to capture the first live boundary evidence.
