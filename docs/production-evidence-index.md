# Production Evidence Index

This index tracks whether production-readiness claims have actual environment or drill evidence.

Do not store secret values, resident/care payloads, access tokens, or raw incident evidence in this file.

Use restricted evidence systems where required and record only safe references here.

## Environment records

| Environment | Commit / release | Evidence record | Status | Reviewer | Date |
|---|---|---|---|---|---|
| synthetic reviewer demo |  | Issue #22 / reviewer URL | pending |  |  |
| staging |  | [Staging Evidence Template](staging-evidence-template.md) | pending |  |  |
| production |  | restricted evidence record | not provisioned |  |  |

## Repository / CI evidence

| Control | Evidence |
|---|---|
| Security Audit Round 1 | Issue #45 |
| main CI | GitHub Actions `CI` |
| real PostgreSQL integration | `postgres-integration` job |
| immutable CI action/image refs | `.github/workflows/ci.yml` |
| locked TypeScript toolchain | `package-lock.json` + supply-chain tests |
| branch protection | Issue #10 — pending GitHub setting |

## Runtime security evidence

| Control | Implementation evidence | Environment evidence |
|---|---|---|
| tenant/RBAC authorization | `src/access/`, application tests | staging record |
| responder Case-scoped visibility | authorization regression tests | staging record |
| runtime DB least privilege | SQL + real Postgres tests | staging DB privilege check |
| membership control plane | `src/membership-admin/` | staging provision/revoke drill |
| strict browser origin | origin/CORS tests + credential-free staging preflight | staging live-origin / manual `Staging Preflight` workflow run |
| request admission | admission tests | staging shared/edge provider |
| outbound timeouts | transport tests | staging config review |
| browser token boundary | session/client tests | staging browser review |

## Operations evidence

| Control | Repository evidence | Environment/drill evidence |
|---|---|---|
| health/readiness | ops runtime tests + credential-free staging preflight | staging monitor / manual `Staging Preflight` workflow run |
| structured logs | non-PII schema tests | staging log sink |
| metrics | ops contract | staging metrics backend |
| outbox health | read-only health projection | staging monitor |
| dead-letter response | outbox runbook | synthetic dead-letter drill |
| incident response | incident runbook | tabletop/drill |
| backup/restore | backup runbook | synthetic restore drill |
| rollback | rollback runbook | deployment rollback drill |
| secret rotation | deployment contract | rotation drill |

## Human / governance evidence

| Control | Status | Evidence reference |
|---|---|---|
| target-operator workflow validation | pending |  |
| accessibility review | pending |  |
| data classification | pending |  |
| retention/deletion policy | pending |  |
| privacy/legal review | pending |  |
| PoC governance approval | pending |  |

## Promotion rule

A repository capability marked “Implemented + tested” is **not** equivalent to a production control being configured.

Production resident/care data remains prohibited until the applicable items in:

- `docs/release-checklist.md`
- this evidence index
- Issue #64

have actual environment/drill evidence and the responsible organization approves the deployment.
