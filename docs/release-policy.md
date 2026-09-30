# Release Policy

Mimamori Care Ops is currently pre-1.0 and not approved for production resident/care data.

## Main branch

`main` represents the latest reviewed integration state.

Expected path:

```
branch -> pull request -> CI -> squash merge -> main
```

## Versioning

Until production-readiness criteria are met, releases use pre-1.0 semantic versions:

```
0.MINOR.PATCH
```

Guidance:

- MINOR: externally meaningful capability or architectural boundary
- PATCH: bug fix, hardening, documentation, or compatible refinement

A `1.0.0` release must not be created merely because the Core is feature-complete.

It requires an explicit production-readiness review against `docs/release-checklist.md`.

## Tags

Release tags should be immutable and created from a green `main` commit.

Recommended format:

```
v0.x.y
```

Do not move an existing release tag.

## Release evidence

Before a tagged release:

- `verify` CI must pass
- `postgres-integration` CI must pass
- relevant ADRs must be current
- Project Status must match the code
- no real resident/care data may be present
- known non-production boundaries must remain explicit

## Security fixes

Security-sensitive fixes should use a focused PR and regression test.

Do not publish exploit details in a public issue when the repository becomes public or externally shared.

## Production releases

Any release intended for production must additionally satisfy applicable items in:

- [Production Release Checklist](release-checklist.md)
- [Security Policy](../SECURITY.md)
- [Repository Governance](repository-governance.md)

Production approval is an operational/governance decision, not a version-number side effect.
