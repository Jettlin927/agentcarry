import { describe, expect, it, vi } from "vitest";
import { createAgentCarryHandlers } from "../src/application.js";
import type {
  CanonicalSourceEvent,
  SourceReader,
  SourceSession
} from "../src/adapters/source-reader.js";
import type { TargetLauncher } from "../src/adapters/target-launcher.js";
import {
  ClaudeTargetLauncher,
  type LaunchRunner
} from "../src/adapters/claude/target-launcher.js";
import type { CollectedWorkspaceEvidence } from "../src/workspace/collect-workspace.js";
import type { DoctorReport } from "../src/diagnostics/doctor.js";

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
    capture: vi.fn(async () => ({
      events,
      snapshot: {
        capturedAt: "2026-07-21T00:01:30Z",
        byteLength: 100,
        sha256: "a".repeat(64),
        changedDuringCapture: false,
        trailingFragmentIgnored: false
      }
    }))
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
    const createLauncher = vi.fn((_cwd: string): TargetLauncher => launcher);
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
      expect(result.human).toContain("Codex session: source-session");
      expect(result.human).toContain("First action:");
      expect(result.human).toContain("Loss receipt:");
      expect(result.human).toContain("claude --resume");
    }
  });

  it("launches the already prepared handoff and returns a human completion result", async () => {
    const runLaunch = vi.fn<LaunchRunner>(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const launcher = new ClaudeTargetLauncher({
      cwd: workspace.workspace.primaryRoot,
      createSessionId: () => "11111111-1111-4111-8111-111111111111",
      runLaunch
    });
    const handlers = createAgentCarryHandlers({
      cwd: "C:\\repo",
      codexReader: reader(),
      collectWorkspace: async () => workspace,
      createClaudeLauncher: () => launcher
    });
    const options = { target: "claude", session: "source-session", force: false };
    const prepared = await handlers.prepareContinue(options);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const launched = await handlers.launchContinue(options, prepared);

    expect(launched).toMatchObject({
      ok: true,
      data: {
        agent: "claude",
        targetSessionId: "11111111-1111-4111-8111-111111111111",
        completedSteps: ["seed-session", "resume-interactive"]
      },
      human: "Claude Code session ended normally."
    });
    expect(runLaunch).toHaveBeenCalledTimes(2);
  });

  it("maps a failed target seed to exit code 5 without leaking target output", async () => {
    const runLaunch: LaunchRunner = vi.fn(async () => ({
      exitCode: 9,
      stdout: "private output",
      stderr: "private error"
    }));
    const launcher = new ClaudeTargetLauncher({ cwd: workspace.workspace.primaryRoot, runLaunch });
    const handlers = createAgentCarryHandlers({
      cwd: "C:\\repo",
      codexReader: reader(),
      collectWorkspace: async () => workspace,
      createClaudeLauncher: () => launcher
    });
    const options = { target: "claude", force: false };
    const prepared = await handlers.prepareContinue(options);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const launched = await handlers.launchContinue(options, prepared);

    expect(launched).toMatchObject({
      ok: false,
      exitCode: 5,
      code: "TARGET_SEED_FAILED"
    });
    expect(JSON.stringify(launched)).not.toContain("private output");
    expect(JSON.stringify(launched)).not.toContain("private error");
  });

  it("captures before requesting an active checkpoint and records explicit losses", async () => {
    const activeSession: SourceSession = { ...session, activity: "active" };
    const ready = vi.fn();
    const read = vi.fn(async () => JSON.stringify({
      schemaVersion: "1.0.0",
      currentUserMessage: "Fix the parser without changing exports.",
      assistantCheckpoint: "The parser edit is complete. Full integration tests remain pending."
    }));
    const capture = vi.fn(async () => {
      expect(ready).not.toHaveBeenCalled();
      return {
        events: [events[0]!],
        snapshot: {
          capturedAt: "2026-07-21T00:01:30Z",
          byteLength: 100,
          sha256: "b".repeat(64),
          changedDuringCapture: true,
          trailingFragmentIgnored: true
        }
      };
    });
    const activeReader: SourceReader = {
      agent: "codex",
      discover: vi.fn(async () => [activeSession]),
      select: vi.fn(async () => activeSession),
      capture
    };
    const launcher = new ClaudeTargetLauncher({
      cwd: workspace.workspace.primaryRoot,
      createSessionId: () => "22222222-2222-4222-8222-222222222222",
      runCommand: vi.fn()
    });
    const handlers = createAgentCarryHandlers({
      cwd: "C:\\repo",
      codexReader: activeReader,
      collectWorkspace: async () => workspace,
      createClaudeLauncher: () => launcher
    });

    const result = await handlers.prepareContinue({
      target: "claude",
      force: false,
      active: true,
      checkpointStdin: { ready, read }
    });

    expect(result.ok).toBe(true);
    expect(activeReader.select).toHaveBeenCalledWith({ cwd: "C:\\repo", activity: "active" });
    expect(capture).toHaveBeenCalledBefore(read);
    expect(ready).toHaveBeenCalledBefore(read);
    if (result.ok) {
      const prepared = result.data as {
        capsule: {
          currentUserMessage: { text: string };
          pending: Array<{ text: string }>;
          source: { snapshot: { changedDuringCapture: boolean } };
          losses: Array<{ code: string }>;
        };
      };
      expect(prepared.capsule.currentUserMessage.text).toBe(
        "Fix the parser without changing exports."
      );
      expect(prepared.capsule.pending.at(-1)?.text).toContain("Full integration tests remain pending");
      expect(prepared.capsule.source.snapshot.changedDuringCapture).toBe(true);
      expect(prepared.capsule.losses.map((loss) => loss.code)).toEqual(expect.arrayContaining([
        "SOURCE_AGENT_CHECKPOINT",
        "NATIVE_PARTIAL_ASSISTANT_OUTPUT_EXCLUDED",
        "APPEND_DURING_SOURCE_CAPTURE",
        "TRAILING_SOURCE_FRAGMENT_IGNORED"
      ]));
    }
  });

  it("keeps target diagnostics separate and non-mutating", async () => {
    const report: DoctorReport = {
      schemaVersion: "1.0.0",
      checks: [{
        id: "claude-cli",
        available: false,
        version: null,
        compatibility: "unsupported",
        authentication: "unknown",
        detail: "not found"
      }],
      storage: [],
      policies: {
        installsAgents: false,
        managesAuthentication: false,
        mutatesConfiguration: false,
        networkTelemetry: false,
        updateCheck: false
      }
    };
    const diagnose = vi.fn(async () => report);
    const handlers = createAgentCarryHandlers({
      cwd: "C:\\repo",
      codexReader: reader(),
      collectWorkspace: async () => workspace,
      diagnose
    });

    await expect(handlers.doctor()).resolves.toMatchObject({
      ok: true,
      data: {
        checks: [{ available: false }],
        policies: {
          installsAgents: false,
          managesAuthentication: false
        }
      }
    });
    expect(diagnose).toHaveBeenCalledOnce();
  });
});
