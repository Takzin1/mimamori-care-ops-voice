# ADR 0001: Last-mile product boundary

Status: Accepted

Date: 2026-09-25

## Context

The 2026 Mimamori-kun PoC accumulated multiple upstream monitoring functions: check-ins, notifications, welfare checks, crisis modes, cold-region reporting, and municipal dashboards.

Field learning showed that the more defensible operational problem begins after detection:

> A human-attention signal exists, but nobody can yet prove who owns it, what action occurred, whether responsibility changed hands safely, or whether support was actually completed.

## Decision

The new product boundary is the Case lifecycle from human-attention signal to verifiable support completion.

The core product will optimize for accountable completion rather than signal volume, notification delivery, or AI usage.

## Consequences

We will:

- keep Signal sources modular
- require explicit Case ownership
- model handoff acceptance
- require completion evidence
- preserve append-only operational events
- measure Time to Completion as the north-star KPI

We will not make generic municipal content, sensor ingestion breadth, or AI model usage part of the Core.
