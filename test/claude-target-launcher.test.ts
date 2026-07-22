import { describe, expect, it, vi } from "vitest";
import type { CapsuleBuildResult, WorkCapsule } from "../src/capsule/build-capsule.js";
import {
  ClaudeTargetLauncher,
  buildContinuationPrompt,
  renderCapsuleJson,
  renderCapsuleMarkdown,
  type CommandRunner
} from "../src/adapters/claude/target-launcher.js";

const capsule = {
  schemaVersion: "2.0.0",
  source: { agent: "codex", sessionId: "source-1", capturedAt: "2026-07-21T00:00:00Z" },
  workspace: {
    primaryRoot: "C:\\Users\\dev\\中文 项目",
    additionalRoots: [],
    capturedAt: "2026-07-21T00:00:01Z"
  },
  currentUserMessage: { text: "Write the focused test.", evidenceRefs: ["event:1"], inferred: false },
  objective: { text: "Fix the parser.", evidenceRefs: ["event:2"], inferred: false },
  constraints: [
    { text: "Do not change exports.", evidenceRefs: ["event:3"], inferred: false }
  ],
  decisions: [],
  failedAttempts: [],
  completed: [],
  pending: [
    { text: "Write the focused test.", evidenceRefs: ["event:1"], inferred: false }
  ],
  nextAction: {
    first: { text: "Write the focused test.", evidenceRefs: ["event:1"], inferred: false },
    then: [],
    forbiddenBefore: []
  },
  files: [],
  commands: [],
  validations: [],
  openQuestions: [],
  evidenceRefs: [
    { id: "event:1", kind: "session-event", locator: "fixture:1" },
    { id: "event:2", kind: "session-event", locator: "fixture:2" },
    { id: "event:3", kind: "session-event", locator: "fixture:3" }
  ],
  losses: [
    {
      code: "HIDDEN_AGENT_STATE_UNAVAILABLE",
      severity: "info",
      description: "Hidden state is not transferable.",
      affectedFields: []
    }
  ],
  lineage: { capsuleId: "capsule-1", rootCapsuleId: "capsule-1", hops: [] }
} satisfies WorkCapsule;

const result: CapsuleBuildResult = {
  capsule,
  receipt: {
    canContinue: true,
    forced: false,
    criticalLosses: 0,
    warnings: 0,
    information: 1,
    losses: capsule.losses
  }
};

describe("ClaudeTargetLauncher", () => {
  it("prepares an exact two-step plan without starting a child process", () => {
    const runner = vi.fn<CommandRunner>();
    const launcher = new ClaudeTargetLauncher({
      cwd: "C:\\Users\\dev\\中文 项目",
      createSessionId: () => "11111111-1111-4111-8111-111111111111",
      runCommand: runner
    });

    const prepared = launcher.prepare(result);

    expect(runner).not.toHaveBeenCalled();
    expect(prepared.prerequisitesVerified).toBe(false);
    expect(prepared.steps).toEqual([
      {
        purpose: "seed-session",
        command: "claude",
        args: [
          "--session-id",
          "11111111-1111-4111-8111-111111111111",
          "--print",
          "--output-format",
          "json"
        ],
        cwd: "C:\\Users\\dev\\中文 项目",
        stdin: "capsule-prompt",
        displayCommand: "claude --session-id 11111111-1111-4111-8111-111111111111 --print --output-format json < capsule-prompt"
      },
      {
        purpose: "resume-interactive",
        command: "claude",
        args: ["--resume", "11111111-1111-4111-8111-111111111111"],
        cwd: "C:\\Users\\dev\\中文 项目",
        stdin: "inherit",
        displayCommand: "claude --resume 11111111-1111-4111-8111-111111111111"
      }
    ]);
    expect(prepared.steps.flatMap((step) => step.args)).not.toContain("--model");
    expect(prepared.steps.flatMap((step) => step.args)).not.toContain("--permission-mode");
  });

  it("renders Markdown around the exact canonical JSON facts", () => {
    const json = renderCapsuleJson(capsule).trim();
    const markdown = renderCapsuleMarkdown(capsule);

    expect(markdown).toContain(json);
    expect(markdown).toContain("HIDDEN_AGENT_STATE_UNAVAILABLE");
    expect(buildContinuationPrompt(capsule)).toContain(markdown);
  });

  it("diagnoses CLI and auth metadata without returning account identity", async () => {
    const runner: CommandRunner = vi.fn(async (_command, args) =>
      args[0] === "--version"
        ? { exitCode: 0, stdout: "2.1.158 (Claude Code)\n", stderr: "" }
        : {
            exitCode: 0,
            stdout: JSON.stringify({
              loggedIn: true,
              authMethod: "claude.ai",
              apiProvider: "firstParty",
              subscriptionType: "max",
              email: "private@example.com",
              orgId: "private-org"
            }),
            stderr: ""
          }
    );
    const launcher = new ClaudeTargetLauncher({ cwd: ".", runCommand: runner });

    const diagnostic = await launcher.diagnose();

    expect(diagnostic).toEqual({
      agent: "claude",
      available: true,
      version: "2.1.158 (Claude Code)",
      authentication: "reported-authenticated",
      details: ["claude.ai", "firstParty", "max"]
    });
    expect(JSON.stringify(diagnostic)).not.toContain("private@example.com");
    expect(JSON.stringify(diagnostic)).not.toContain("private-org");
  });

  it("reports a missing CLI without attempting authentication", async () => {
    const runner: CommandRunner = vi.fn(async () => {
      throw new Error("spawn claude ENOENT");
    });
    const launcher = new ClaudeTargetLauncher({ cwd: ".", runCommand: runner });

    await expect(launcher.diagnose()).resolves.toMatchObject({
      available: false,
      authentication: "unknown"
    });
    expect(runner).toHaveBeenCalledOnce();
  });
});

