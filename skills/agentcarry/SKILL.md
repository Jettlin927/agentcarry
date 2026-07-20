---
name: agentcarry
description: Prepare evidence-backed, read-only handoffs between coding agents with AgentCarry. Use when the user asks to switch, continue, migrate, or inspect an existing coding task across Codex, Claude Code, OpenCode, Gemini CLI, or Pi sessions, including requests to preserve current context or show what will be lost.
---

# AgentCarry handoff

Use the installed `agentcarry` CLI. Do not install AgentCarry, install or update
another coding agent, manage credentials, start a login flow, or change the
target's model, provider, permissions, tools, skills, or MCP configuration.

## Mandatory current-task route

Apply this before automatic session selection. If the request refers to the
current, active, ongoing, still-running, or just-finished-in-this-turn task, use
the active checkpoint protocol below. Never omit `--active`, silently select an
older idle session, or put checkpoint content in the shell command, clipboard,
a screenshot, an upload, or a temporary transcript file.

## Active checkpoint protocol

1. Copy the visible current user message exactly; AgentCarry normalizes only its
   terminal line ending for binding and retains the native text verbatim. Write a concise
   `assistantCheckpoint` containing only explicit completed work, decisions,
   failed paths, pending work, and the exact next action. Do not include hidden
   reasoning or claim that partial native output is complete.
2. Run `agentcarry doctor --json` and apply the prerequisite checks below.
3. Start this one CLI command through an execution tool that supports sending
   stdin to a running process:

   ```text
   agentcarry continue --to <target> --active --checkpoint-stdin --dry-run --json
   ```

   Add `--session <id>` only when the current session ID is known. Active mode
   selects only a unique active main session in the current workspace and never
   falls back to idle history.
4. Wait for `CHECKPOINT_STDIN_READY` on stderr. Then send exactly one UTF-8 JSON
   line on the process stdin using this schema:

   ```json
   {"schemaVersion":"1.0.0","currentUserMessage":"verbatim user message","assistantCheckpoint":"explicit completed checkpoint"}
   ```

5. If the execution tool cannot provide stdin after process start, stop and
   report that prerequisite. Do not fall back to command-line JSON, a pipe that
   embeds JSON in the recorded command, clipboard, screenshots, or uploads.

## Prepare a handoff

1. Identify the requested source, target, workspace, and explicit session ID if
   supplied. Do not silently choose a different target.
   - Use target ID `claude` for Claude Code.
2. Run `agentcarry doctor --json` unless already run for the active protocol.
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

- If active selection is missing or ambiguous, stop and show the candidates.
  Never retry without `--active` and never fall back to an idle session.
- If the checkpoint message does not match the last complete native
  user message, stop and correct the checkpoint; do not use `--force`.
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
