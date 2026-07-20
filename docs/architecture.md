# Architecture

AgentCarry is organized around one deep module: continue an existing task in a
target agent. Callers should not need to understand vendor log shapes, selection
heuristics, redaction, freshness, rendering, or launch protocols.

```text
CLI / Skill / JSON caller
          │
          ▼
 ContinueTask interface
          │
   ┌──────┼─────────┐
   ▼      ▼         ▼
select  build     launch
source  capsule   target
   │      │         │
 Reader  workspace  Launcher
adapter  evidence   adapter
```

## External interface

The initial public command interface is intentionally small:

- `agentcarry inspect`
- `agentcarry continue`
- `agentcarry doctor`

Stable machine mode writes JSON to stdout and diagnostics to stderr. The capsule
schema is versioned separately from CLI releases.

## Internal seams

### Source Reader

A Reader discovers sessions, selects or opens one read-only, and returns
canonical evidence events. It does not build a capsule and does not mutate the
source agent.

Data-access preference:

1. official session/export/app-server interface;
2. documented local storage;
3. private JSONL or SQLite fallback guarded by versioned fixtures.

### Target Launcher

A Launcher reports target capabilities and starts a new session with rendered
capsule content. It never installs the target agent, manages authentication,
changes the model, expands permissions, or rewrites native session storage.

### Capsule builder

The builder combines evidence events with current read-only workspace facts,
redacts secrets, applies the token budget, and produces a capsule plus losses.
Critical uncertainty is an error, not a warning.

## Selection order

1. current session ID supplied by a Skill or hook;
2. explicit `--session`;
3. latest non-subagent session in the current workspace;
4. an interactive list when multiple candidates remain.

## State precedence

Current filesystem and Git facts beat stale transcript statements. AgentCarry
records collection time and Git state. It does not rerun tests during handoff;
existing validation results are marked with their original time and freshness.

## Persistence

Capsules are ephemeral by default. Persisted lineage contains source ID, target
ID when known, timestamp, capsule hash, and loss summary—not a duplicated chat.

