# Roadmap

The core verb remains `continue`. New releases add adapters and evidence quality,
not unrelated product categories.

## Phase 0 — Continuity benchmark

Exit criteria:

- twelve controlled fixtures across debugging, refactoring, half-complete
  features, and architecture/performance decisions;
- visible-transcript, deterministic-capsule, and source-assisted modes;
- public scorer plus complete human-review rubric;
- redacted fixtures representative of real Codex and Claude Code event shapes;
- a published result even when AgentCarry does not beat the baseline.

## v0.1 — Codex to Claude Code

Exit criteria:

- end-to-end dry-run and interactive launch;
- source session remains byte-for-byte unchanged;
- a current active task can supply one explicit stdin checkpoint after a
  verified native snapshot, without screenshots, clipboard, or transcript files;
- critical constraints score 100% in the benchmark;
- capsule fidelity is no worse than the visible-transcript baseline;
- secret redaction, fail-closed behavior, dry-run, and large/live JSONL tests;
- Windows, macOS, and Ubuntu CI;
- `doctor` diagnoses prerequisites without installing or authenticating agents.

## v0.2 — Claude Code to OpenCode

- first second-source and second-target adapter;
- proof that the Reader and Launcher seams are real rather than hypothetical;
- capsule schema remains independent of any one vendor.

## v0.3 — Three-agent bidirectional core

- Codex, Claude Code, and OpenCode as both sources and targets;
- compatibility matrix and automatic fixture regression detection;
- multi-hop lineage retains original evidence rather than summarizing summaries.

## v0.4 — Pi and Gemini CLI

- add adapters through the same Reader/Launcher interfaces;
- preserve target-owned models, providers, skills, MCP, permissions, and auth.

## v0.5 — Discovery and repository Skill

- cross-history `find` is a selector for `continue`, not a separate product;
- canonical `skills/agentcarry/SKILL.md`;
- README installation guidance; no `agentcarry install-skill` command.

## v0.6 — Optional ACP runtime

- only for sessions launched or resumed through AgentCarry;
- reuse the official ACP SDK or an established client;
- never claim ACP can attach to arbitrary independent terminal sessions.

## Explicitly not planned for 0.x

- desktop or web dashboard;
- cloud sync or accounts;
- editor plugins;
- agent installation or authentication management;
- real-time peer messaging or general workflow orchestration;
- remote-control UI;
- PNG sharing cards.
