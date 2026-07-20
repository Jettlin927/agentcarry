# ADR 0003: Separate Source Readers from Target Launchers

- Status: Accepted
- Date: 2026-07-21

## Context

Pairwise converters grow as source × target and embed vendor behavior in core
logic.

## Decision

Each supported agent supplies a Source Reader and/or Target Launcher. Readers
produce canonical evidence events. Launchers consume a rendered Work Capsule and
target capability report.

Adapters are internal to one npm package during 0.x. Community adapters live in
the core repository and require fixtures and version metadata. No runtime plugin
loading is provided.

## Consequences

- Adding an agent is linear rather than pairwise.
- The seam becomes proven after the second Reader and Launcher.
- Tests exercise observable behavior through the continue interface and adapter
  fixtures, not private implementation details.

