# Competitive landscape

Checked on 2026-07-21. The category is active; AgentCarry must stay narrow.

| Project | Primary job | What remains distinct for AgentCarry |
| --- | --- | --- |
| [AgentWorkforce/relay](https://github.com/AgentWorkforce/relay) | Spawn, message, coordinate, and resume agents managed through its runtime | Existing native-session readers, neutral evidence-backed capsule, loss receipt, cross-vendor lineage, continuation-fidelity benchmark |
| [ContextRelay](https://github.com/proofofwork-agency/contextrelay) | Real-time Claude/Codex collaboration with a persistent ledger | Retroactive native-history transfer and a vendor-neutral capsule with explicit loss |
| [HacksonClark/handoff](https://github.com/HacksonClark/handoff) | Read and inject Claude/Codex/OpenCode transcripts | Evidence references, workspace freshness, fail-closed loss semantics, lineage, and benchmark |
| [atakanturg/agent-handoff](https://github.com/atakanturg/agent-handoff) | Agent-authored handoff file near a context limit | Retroactive extraction from sessions that were not prepared for handoff |
| [chat-history](https://github.com/ay-bh/chat-history) | Search, inspect, export, and resume coding-agent history | Task-state continuation rather than history management |
| [acpx](https://acpx.sh/) | Unified ACP control for ACP-managed sessions | State reconstruction from existing private local sessions |

## Decision

AgentCarry does not compete on agent orchestration, live peer messaging, remote
control, or a dashboard. Its durable seam is:

> existing local session → evidence-backed Work Capsule → new target session

The project should be stopped or repositioned if another maintained product
demonstrates all of the following together:

1. reads existing native histories from at least three coding agents;
2. creates a neutral, versioned task-state capsule;
3. attaches fact-level evidence and workspace freshness;
4. emits explicit, fail-closed transfer losses;
5. preserves multi-hop lineage;
6. publishes a reproducible continuation-quality benchmark.

