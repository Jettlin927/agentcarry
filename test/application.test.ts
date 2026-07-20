import { describe, expect, it, vi } from "vitest";
import { createAgentCarryHandlers } from "../src/application.js";
import type {
  CanonicalSourceEvent,
  SourceReader,
  SourceSession
} from "../src/adapters/source-reader.js";
import type { TargetLauncher } from "../src/adapters/target-launcher.js";
import { ClaudeTargetLauncher } from "../src/adapters/claude/target-launcher.js";
import type { CollectedWorkspaceEvidence } from "../src/workspace/collect-workspace.js";

const session: SourceSession = {
  agent: "codex",
  id: "source-session",
  path: "C:\\sessions\\source.jsonl",
  cwd: "C:\\repo",
  agentVersion: "test",
  modifiedAt: "2026-07-21T00:00:00Z",
  kind: "main",
  activity: "idle",
  hasMessages: true
};

const events: readonly CanonicalSourceEvent[] = [
  {
    id: "user-1",
    kind: "user-message",
    timestamp: "2026-07-21T00:00:00Z",
    locator: "fixture:1",
    text: "Fix the parser without changing exports."
  },
  {
    id: "assistant-1",
    kind: "assistant-message",
    timestamp: "2026-07-21T00:01:00Z",
    locator: "fixture:2",
    text: "The parser test now passes; the integration test is pending."
  }
];

const workspace: CollectedWorkspaceEvidence = {
  workspace: {
    primaryRoot: "C:\\repo",
    additionalRoots: [],
    capturedAt: "2026-07-21T00:02:00Z",
    instructionFiles: []
  },
  files: []
};

function reader(): SourceReader {
  return {
    agent: "codex",
    discover: vi.fn(async () => [session]),
    select: vi.fn(async () => session),
    async *events() {
      yield* events;
    }
  };
}

describe("AgentCarry production handlers", () => {
  it("prepares Codex to Claude without launching or diagnosing Claude", async () => {
    const commandRunner = vi.fn();
    const launcher = new ClaudeTargetLauncher({
      cwd: workspace.workspace.primaryRoot,
      createSessionId: () => "11111111-1111-4111-8111-111111111111",
      runCommand: commandRunner
    });
    const createLauncher = vi.fn((_cwd: string): Pick<TargetLauncher, "prepare" | "diagnose"> => launcher);
    const collectWorkspace = vi.fn(async () => workspace);
    const handlers = createAgentCarryHandlers({
      cwd: "C:\\repo",
      codexReader: reader(),
      collectWorkspace,
      createClaudeLauncher: createLauncher
    });

    const result = await handlers.prepareContinue({
      target: "claude",
      session: "source-session",
      force: false
    });

    expect(result.ok).toBe(true);
    expect(commandRunner).not.toHaveBeenCalled();
    expect(collectWorkspace).toHaveBeenCalledWith(session.cwd);
    expect(createLauncher).toHaveBeenCalledWith(workspace.workspace.primaryRoot);
    if (result.ok) {
      expect(result.data).toMatchObject({
        agent: "claude",
        targetSessionId: "11111111-1111-4111-8111-111111111111",
        prerequisitesVerified: false,
        lossReceipt: { canContinue: true }
      });
      expect(JSON.stringify(result.data)).toContain("claude --resume 11111111-1111-4111-8111-111111111111");
    }
  });

  it("keeps target diagnostics separate and non-mutating", async () => {
    const diagnose = vi.fn(async () => ({
      agent: "claude",
      available: false,
      version: null,
      authentication: "unknown" as const,
      details: ["not found"]
    }));
    const handlers = createAgentCarryHandlers({
      cwd: "C:\\repo",
      codexReader: reader(),
      collectWorkspace: async () => workspace,
      createClaudeLauncher: () => ({
        prepare: vi.fn(),
        diagnose
      })
    });

    await expect(handlers.doctor()).resolves.toMatchObject({
      ok: true,
      data: {
        checks: [{ available: false }],
        installsAgents: false,
        managesAuthentication: false
      }
    });
    expect(diagnose).toHaveBeenCalledOnce();
  });
});
