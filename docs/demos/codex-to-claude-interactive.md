# Codex to Claude Code interactive launch

This record verifies the exact public non-dry-run command against a real Claude
Code CLI without committing a private transcript or credential.

## Windows real-target smoke

Date: 2026-07-23  
Runtime: Windows, Node.js 22.18.0, Claude Code 2.1.158  
Source: one temporary sanitized, completed Codex JSONL fixture  
Target: the user's already configured Claude Code CLI; AgentCarry performed no
installation, login, provider selection, or authentication change

The test built the current branch, pointed `CODEX_HOME` at the temporary
fixture, and ran one public command:

```text
node dist/cli-main.js continue --to claude --session 99999999-9999-4999-8999-999999999999
```

The non-TTY harness supplied one `yes` line at the confirmation prompt. The
source task asked only for the exact reply `AgentCarry interactive smoke
complete.` and explicitly prohibited tools and file changes.

Observed result:

```text
Codex session: 99999999-9999-4999-8999-999999999999
First action: Review the latest agent state before continuing: No work has started.
Loss receipt: 0 critical, 1 warning, 1 info
AgentCarry interactive smoke complete.
Claude Code session ended normally.
process exit: 0
```

AgentCarry invoked the planned stdin seed and exact interactive resume command
with one generated target session ID. The real seed accepted the context, the
resume saw that same context and returned the requested message, and no target
output was used as AgentCarry control data.

The source file was hashed immediately before and after the complete command:

```text
SHA-256 before: C7241CCBF609E36F9F33FAEF57BCFB0F52E9E20F1CC0B72F279974FE6C102140
SHA-256 after:  C7241CCBF609E36F9F33FAEF57BCFB0F52E9E20F1CC0B72F279974FE6C102140
bytes unchanged: true
```

The temporary fixture contained no real conversation, was removed after the
test, and is not part of the repository.

## Cross-platform boundary

Provider-authenticated Claude Code cannot run on anonymous GitHub-hosted
runners. The CI suite therefore exercises the same complete CLI, Reader,
Capsule, confirmation, Launcher, stdin-write, child-process, cancellation,
redaction, JSON, and source-hash boundaries with controlled target processes on:

- Windows, Node.js 22 and 24;
- macOS, Node.js 22 and 24;
- Ubuntu, Node.js 22 and 24.

The child-process test uses a temporary working directory containing both a
space and Chinese characters. A regression test also forces the seed process to
close before a large prompt finishes writing; launch must fail before resume.
A separate zero-exit/empty-output case proves that writing into an OS pipe is
not enough: resume requires a valid same-session Claude acknowledgment.
Together with the real Windows target smoke, this separates portable process
behavior from provider credentials while keeping both claims auditable.
