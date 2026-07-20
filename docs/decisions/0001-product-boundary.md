# ADR 0001: Product boundary is coding-agent task continuity

- Status: Accepted
- Date: 2026-07-21

## Context

Search, export, raw transcript injection, ACP control, and live multi-agent
coordination already have credible implementations. Combining them would create
a broad tool with no stable core verb.

## Decision

AgentCarry reads an existing local coding-agent session, builds an
evidence-backed Work Capsule with a loss receipt, and starts a new target session
that can continue the task.

The core verb is `continue`.

## Consequences

- Source sessions are never modified.
- The first path is Codex → Claude Code; the second is Claude Code → OpenCode.
- OpenClaw remains experimental because it is broader than coding-agent task
  continuity.
- Search supports session selection but is not the product center.
- AgentCarry does not install agents, manage credentials, orchestrate teams, or
  provide live peer messaging.

