# ADR 0002: Use a versioned Work Capsule and explicit loss receipt

- Status: Accepted
- Date: 2026-07-21

## Context

Vendor sessions are not isomorphic. Hidden reasoning, prompt caches, tool state,
permissions, attachments, and native message trees cannot be promised to move.
Raw transcript injection is also noisy, secret-prone, and difficult to measure.

## Decision

AgentCarry transfers a neutral, versioned Work Capsule. Facts carry evidence
references or an `inferred` marker. Unsupported state appears in a loss receipt.

The current user message and critical constraints are never silently truncated.
Missing critical state fails closed; `--force` is an explicit one-shot override.

Capsule v2 makes the continuation order explicit through `nextAction.first`,
`nextAction.then`, and `nextAction.forbiddenBefore`. Deterministic builders cite
the source event used for the first action and mark failure-derived actions as
inferred; source-assisted builders may split later or blocked actions only when
the supplied evidence supports that ordering. Deterministic builders split only
explicit temporal language; they do not invent test-first order from status
prose. Semantic inference belongs to the source-assisted mode and remains a
measured benchmark claim. Capsule v1 remains immutable for
reproducing Phase 0 artifacts.

## Consequences

- The schema is public JSON Schema and independently versioned.
- JSON is canonical; Markdown is a rendering.
- Multi-hop transfers preserve original evidence and lineage.
- Capsule output is ephemeral unless explicitly kept.
