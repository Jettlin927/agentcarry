---
name: agentcarry
description: Prepare evidence-backed, read-only handoffs between coding agents with AgentCarry. Use when the user asks to switch, continue, migrate, or inspect an existing coding task across Codex, Claude Code, OpenCode, Gemini CLI, or Pi sessions, including requests to preserve current context or show what will be lost.
---

# AgentCarry handoff

Use the installed `agentcarry` CLI. Do not install AgentCarry, install or update
another coding agent, manage credentials, start a login flow, or change the
target's model, provider, permissions, tools, skills, or MCP configuration.

## Mandatory current-task guard

Apply this before running any command. If the request refers to the current,
active, ongoing, still-running, or just-finished-in-this-turn task, stop without
running `doctor` or automatic session selection. Explain that this version
cannot capture the active turn safely and could select an older idle session in
the same workspace. Report
[issue #29](https://github.com/Jettlin927/agentcarry/issues/29). Do not work
around it with screenshots, clipboard, transcript uploads, or a guessed session.

## Prepare a handoff

1. Identify the requested source, target, workspace, and explicit session ID if
   supplied. Do not silently choose a different target.
   - Use target ID `claude` for Claude Code.
2. Run `agentcarry doctor --json`.
3. Stop and report the exact missing prerequisite when:
   - AgentCarry is not executable;
   - the target CLI is unavailable;
   - target authentication is `reported-missing` or `unknown`; or
   - the required Source Reader or Target Launcher is `unsupported`.
4. Treat `reported-authenticated` only as the target CLI's local self-report,
   never as proof that a live provider request will succeed.
5. Prepare only a dry-run:

   ```text
   agentcarry continue --to <target> --dry-run --json
   ```

   Add `--source <agent>` or `--session <id>` only when the user supplied or
   selected it.
6. Summarize the Capsule's current user message, objective, pending work,
   workspace freshness, loss receipt, and exact target steps. State explicitly
   that no target session was created.

## Fail closed

- If selection returns `ACTIVE_SESSION`, stop. Explain that this version only
  transfers confirmed-idle sessions and link to
  [AgentCarry issue #29](https://github.com/Jettlin927/agentcarry/issues/29).
  Do not copy a partial active transcript or ask for screenshots/uploads.
- If a critical loss stops continuation, show the loss receipt. Never add
  `--force` automatically. Retry once with `--force` only after the user
  explicitly accepts those named critical losses.
- Never use force for structural failures, an unreadable source, ambiguous
  selection, unsupported versions, missing target/authentication, or schema
  errors.
- Never edit, append to, lock, resume, or otherwise mutate the source session.
- Never claim hidden reasoning, prompt caches, native tool state, permissions,
  test freshness, or unavailable attachments were transferred.

## Current capability boundary

The repository's current vertical slice is Codex to Claude Code dry-run.
Unsupported source/target pairs must stop and report the compatibility result.
Do not remove `--dry-run` or execute the displayed Claude commands until a
released AgentCarry launcher explicitly supports interactive launch.
