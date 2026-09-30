# Contributing

## Development principles

Mimamori Care Ops is intentionally narrow: it owns the **last mile from human-attention signal to verifiable support completion**.

Changes should preserve that product boundary.

## Branch and PR workflow

Do not develop directly on `main`.

Use a focused branch and PR:

```
feat/<scope>
fix/<scope>
security/<scope>
chore/<scope>
docs/<scope>
```

Prefer squash merge after CI passes.

## Required checks

Before requesting review:

```bash
npm run typecheck
npm test
npm run test:coverage
```

The PR must also pass the GitHub Actions CI workflow.

## Architectural changes

Create or update an ADR when a change modifies:

- Case lifecycle semantics
- ownership or handoff semantics
- tenant boundary
- authorization model
- event vocabulary
- completion evidence requirements
- persistence consistency model
- AI responsibility boundary

ADRs live in `docs/adr/`.

## Operational invariants

Do not weaken these without an explicit ADR:

- no ownership gap during handoff
- no status-only completion
- no caller-controlled audit actor
- no stale overwrite
- no cross-tenant addressing by Case ID alone
- current state must remain replayable from events

## Test expectations

Security or lifecycle changes require regression tests for both:

- intended successful path
- prohibited / conflicting path

If a bug could silently corrupt responsibility or audit history, add a test that would have caught it.

## Data policy

Use synthetic data only. Do not commit real resident, medical, care, contact, credential, or production evidence data.

## PR description

Explain:

1. why the change is needed
2. which invariant it affects
3. what is deliberately out of scope
4. how it was tested
5. whether it changes security, data, or deployment assumptions


## Repository governance

The expected integration path is branch -> pull request -> CI -> squash merge -> main.

See `docs/repository-governance.md` for the required `main` protection/ruleset and status-check policy.

See `docs/release-policy.md` for pre-1.0 release semantics.
