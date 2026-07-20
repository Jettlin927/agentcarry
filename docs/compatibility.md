# Compatibility matrix

AgentCarry uses the least private integration available. A status of
`experimental` means fixtures and local verification exist, but the upstream
format is private and can change without notice.

## Runtime support

Node.js 22 is the minimum supported runtime. CI exercises Node.js 22 and 24 on
Windows, macOS, and Ubuntu. Other Node.js releases at or above the minimum are
best-effort until added to that matrix. Odd-numbered and end-of-life releases do
not extend the support window.

The matrix below is checked against version metadata exported by the official
adapters on every CI run.

| Agent | Reader | Launcher | Access tier | Observed version | Status |
| --- | --- | --- | --- | --- | --- |
| Codex | Local JSONL | Planned | Private local-storage fallback | 0.145.0-alpha.18 | Experimental |
| Claude Code | Planned | Dry-run | Official CLI | 2.1.158 | Experimental |
| OpenCode | Planned | Planned | Official CLI / local database | 1.2.10 | Planned |
| Gemini CLI | Planned | Planned | Official CLI / documented storage preferred | — | Planned |
| Pi | Planned | Planned | Official SDK/RPC/ACP preferred | — | Planned |

## Codex Reader policy

- storage: `~/.codex/sessions/**/*.jsonl`;
- source files are opened read-only and never locked for writing;
- only complete JSON lines are evidence; a partial live trailing line is ignored;
- subagent, automation, empty, other-workspace, active, and activity-unknown
  sessions are not auto-selected;
- an explicit session must still be a non-empty main session and confirmed idle;
- private event shapes are covered by sanitized fixtures carrying the observed
  Codex version;
- unsupported or changed shapes degrade honestly instead of guessing.

The local verification on 2026-07-21 discovered 152 Codex sessions and streamed
213 canonical events from a real idle session while its SHA-256 remained
unchanged. The currently active Codex Desktop session was classified as unknown
and therefore fail-closed rather than transferred.

## Claude Launcher policy

- dry-run preparation is pure and starts no Claude process;
- the continuation capsule is planned for stdin, avoiding Windows command-line
  length limits;
- a fresh session ID is seeded in print mode and the same session is then
  resumed interactively;
- model, provider, permissions, tools, skills, MCP configuration, and
  authentication remain Claude Code-owned defaults;
- diagnostics expose only version and non-identifying auth metadata;
- `reported-authenticated` reflects CLI self-reporting, not a successful live
  provider request.

