# Install the AgentCarry Skill

The Skill teaches a coding agent how to prepare a safe AgentCarry handoff. It
does not install AgentCarry or another agent and does not manage authentication.
Review [`skills/agentcarry/SKILL.md`](../skills/agentcarry/SKILL.md) before
installing it.

## Ask the current agent

The recommended installation method is to ask the coding agent that will use
the Skill:

```text
Review https://github.com/Jettlin927/agentcarry/tree/main/skills/agentcarry and install the agentcarry Skill into your own user-level Skill directory. Do not install or update AgentCarry or another coding agent, and do not change authentication. Tell me the exact destination and every file you changed.
```

This lets the current agent choose its native path and explain the write before
performing it.

## Manual paths

Clone or download this repository, then copy the complete
`skills/agentcarry` directory to one destination below. The destination must
still contain `agentcarry/SKILL.md`.

| Agent | User-level destination |
| --- | --- |
| Codex | `~/.codex/skills/agentcarry/` |
| Claude Code | `~/.claude/skills/agentcarry/` |
| OpenCode | `~/.config/opencode/skills/agentcarry/` |
| Gemini CLI | `~/.gemini/skills/agentcarry/` |
| Pi | `~/.pi/agent/skills/agentcarry/` |

On Windows, `~` means the current user's profile directory. Restart the agent,
or use its native Skill reload command when available, after copying.

## Optional third-party installer

The open `skills` CLI is not part of AgentCarry and collects anonymous
telemetry by default. Review its prompts and disable telemetry for the command.
Keep installation interactive; do not use all-agent or confirmation-skipping
flags.

PowerShell:

```powershell
$env:DISABLE_TELEMETRY = "1"
npx skills add Jettlin927/agentcarry --skill agentcarry
```

Bash or zsh:

```bash
DISABLE_TELEMETRY=1 npx skills add Jettlin927/agentcarry --skill agentcarry
```

Choose only the agent and scope you intend when prompted.
