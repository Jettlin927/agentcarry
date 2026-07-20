# Loss receipt semantics

Every prepared continuation includes the Work Capsule and a compact loss
receipt. Losses describe transfer limitations; they are not generic log messages.

## Structural errors

These stop before a schema-valid Capsule exists and cannot be overridden:

- selected source has no complete current user message;
- an active checkpoint is invalid or its current user message differs from the
  last complete native user event;
- a native source prefix changes in place between verification passes;
- evidence IDs collide or the source parser cannot establish event identity;
- cwd/workspace collection cannot establish required fields;
- the resulting Capsule fails its public JSON Schema.

## Critical losses

Critical semantic state is present but not safe enough to continue, for example
when no complete assistant state is available. The receipt sets
`canContinue: false`. A one-shot `--force` may set `canContinue: true` and
`forced: true`; it does not change or hide the loss.

## Warnings

Warnings allow dry-run and, absent critical loss, launch. Current warnings
include deterministic semantic heuristics, unavailable attachment transfer,
secret redaction, an explicit one-shot sensitive-value allowance, and the fact
that an active checkpoint is source-agent-authored rather than independently
verified.

## Information

Information records expected non-portable state such as hidden reasoning, prompt
caches, and native tool state. Active capture also records append activity and
the exclusion of partial native assistant output or an incomplete trailing
event.

## Evidence and freshness

Source event references are namespaced by agent, session, and event identity.
Workspace evidence is keyed by its current snapshot fingerprint. On multi-hop
continuation, original evidence and root lineage remain; current workspace facts
are collected again rather than inherited as fresh.

Loss receipts contain codes, descriptions, severity, and affected field paths.
Secret values never appear in a redaction loss.

