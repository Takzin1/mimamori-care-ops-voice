# Project Status

Last updated: 2026-09-26

Mimamori Care Ops is an **architecture/core prototype**, not a production deployment.

## Capability matrix

| Area | Status | Evidence |
|---|---|---|
| Case state machine | Implemented | `src/core/case-core.ts` |
| Handoff without ownership gap | Implemented + tested | `tests/case-core.test.ts` |
| Completion evidence | Implemented + tested | Core tests |
| Event replay | Implemented + tested | Core / persistence tests |
| TTC metrics | Implemented + tested | `src/core/metrics.ts` |
| Optimistic concurrency | Implemented + tested | Core / persistence tests |
| Tenant-scoped persistence contract | Implemented + tested | `src/persistence/` |
| Staff membership / RBAC | Implemented + tested | `src/access/` |
| Signal idempotency / dedup | Implemented + tested | persistence + SQL contract tests |
| Priority / SLA / aging engine | Implemented + tested | `src/operations/` + SLA tests |
| Case Queue projection | Implemented + tested | `src/operations/queue.ts` + queue tests |
| PostgREST/Supabase runtime repository | Implemented + tested | adapter tests + real Postgres CI |
| Transactional outbox / delivery worker | Implemented + tested | outbox tests + real Postgres CI |
| Payload-free outbox health projection | Implemented + tested | read-only RPC + server monitor + real Postgres CI |
| Incident / recovery / outbox operations runbooks | Implemented | docs; production drills/owners not yet provisioned |
| Postgres Case Store SQL contract | Implemented + static-tested | `db/case_store.sql` |
| Production identity boundary / Supabase Auth reference verifier | Implemented + tested | `src/identity/` + identity tests |
| Persistent tenant membership store | Implemented + tested | `db/identity_store.sql` + real Postgres CI |
| Audited membership provisioning / revocation | Implemented + tested | `src/membership-admin/` + Postgres audit contract |
| Authenticated Care Ops HTTP boundary | Implemented + tested | `src/http/` + `tests/http-api.test.ts` |
| Server-only Supabase runtime composition | Implemented + tested | `src/runtime/` + `tests/runtime.test.ts` |
| Browser-safe Care Ops API client | Implemented + tested | `src/client/` + `tests/client.test.ts` |
| Ephemeral browser session coordinator | Implemented + tested | `src/session/` + `tests/session-controller.test.ts` |
| Supabase browser Auth reference bridge | Implemented + tested | `src/session/supabase-browser-auth-provider.ts` + adapter tests |
| Live Console workspace state model | Implemented + tested | `src/console/` + `tests/live-console-workspace.test.ts` |
| Server-projected operator / Case capabilities | Implemented + tested | shared Core/RBAC predicates + HTTP/client/workspace tests |
| Dependency-free live Console DOM renderer | Implemented + tested | `src/console-web/` + `tests/console-web.test.ts` |
| Provisioned production Auth/login flow | Not implemented | deployment roadmap |
| Responder Console presenter + synthetic reviewer demo | Implemented + tested | `src/presentation/` + `demo/responder-console/` |
| Reviewer demo deployment config | Implemented + tested | `demo/responder-console/vercel.json`; project import tracked in #22 |
| Operational health/readiness + structured observability boundary | Implemented + tested | `src/ops/` + operational runtime tests |
| Operational Supabase runtime composition | Implemented + tested | `src/runtime/operational-supabase-care-ops-runtime.ts` |
| Fail-closed deployment environment + composition root | Implemented + tested | `src/deployment/` + deployment composition tests; provider environment not yet provisioned |
| Secret-safe deployment config doctor + environment template | Implemented + tested | `npm run config:validate` + `.env.example` + CLI/output regression tests |
| Provider-neutral request admission boundary | Implemented + tested | `src/ops/` + `tests/request-admission.test.ts`; production provider not provisioned |
| Strict browser origin / CORS boundary | Implemented + tested | exact-origin policy + narrow preflight; production hostname not provisioned |
| Synthetic staging boundary preflight | Implemented + tested | `src/ops/staging-preflight.ts` + CLI + manual GitHub Actions workflow + regression tests; requires provisioned staging endpoint/origin |
| Integrity-pinned TypeScript CI toolchain | Implemented + tested | `package-lock.json` + frozen CI install + supply-chain regression test |
| Repository governance audit | Implemented + tested | manual read-only workflow checks `main` protection + required `verify` / `postgres-integration`; enforcement setting still pending #10 |
| Security Audit Round 1 | Complete | Issue #45; remediation PRs #46, #49, #50, #54, #56, #58 |
| Live authenticated Responder Console deployment | Not implemented | renderer/Auth bridge exist; production environment + deployment remain |
| Production deployment | Not implemented | release checklist |
| Production PII / care data | **Not allowed** | security policy |

## Current maturity claim

The repository demonstrates that the Last-mile Case model can encode and test:

- accountable ownership
- explicit responsibility transfer
- verifiable support completion
- replayable evidence
- tenant and role boundaries
- conflict-safe updates

It does **not** yet demonstrate a production-grade healthcare/care-service system.

## Next sequence

Repository-side implementation and Security Audit Round 1 are substantially complete.

Remaining work is primarily environment / organizational provisioning:

1. complete one-time repository / reviewer settings (#10, #22)
2. execute staging/production provisioning and operational drills tracked in #64 using the staging evidence template / production evidence index; run `npm run preflight:staging` after staging API + exact Console origin are provisioned
3. configure real shared/edge admission, exact production origin(s), secrets, observability, backup/restore, and outbox provider credentials using the validated `src/deployment/` composition path
4. validate the live workflow with target operators using synthetic/scenario data
5. complete privacy/legal/real-world PoC governance before any production PII or care data

The existence of code/runbooks is not production approval. Issue #64 closes only with environment/drill evidence.
