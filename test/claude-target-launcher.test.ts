import { describe, expect, it, vi } from "vitest";
import type { CapsuleBuildResult, WorkCapsule } from "../src/capsule/build-capsule.js";
import {
  ClaudeTargetLauncher,
  buildContinuationPrompt,
  renderCapsuleJson,
  renderCapsuleMarkdown,
  renderContinuationBrief,
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
    expect(prepared.continuationBrief).toBe(renderContinuationBrief(capsule));
    expect(prepared.capsuleJson).toBe(renderCapsuleJson(capsule));
    expect(prepared.lossReceipt).toBe(result.receipt);
  });

  it("keeps the exact canonical Capsule separate for audit", () => {
    const json = renderCapsuleJson(capsule).trim();
    const markdown = renderCapsuleMarkdown(capsule);

    expect(markdown).toContain(json);
    expect(markdown).toContain("HIDDEN_AGENT_STATE_UNAVAILABLE");
  });

  it("compiles a prioritized brief with each normalized fact exactly once", () => {
    const duplicated = {
      ...capsule,
      constraints: [
        ...capsule.constraints,
        { text: "  write   the focused test. ", evidenceRefs: ["event:3"], inferred: false }
      ],
      nextAction: {
        ...capsule.nextAction,
        forbiddenBefore: [
          { text: "Change public exports.", evidenceRefs: ["event:3"], inferred: false }
        ]
      }
    } satisfies WorkCapsule;

    const brief = renderContinuationBrief(duplicated);

    expect(brief.match(/Write the focused test\./gi)).toHaveLength(1);
    expect(Buffer.byteLength(brief)).toBeLessThan(Buffer.byteLength(renderCapsuleJson(duplicated)));
    expect(brief).toContain("evidence: event:1, event:3");
    expect(brief.indexOf("## First action")).toBeLessThan(brief.indexOf("## Constraints"));
    expect(brief.indexOf("## Forbidden before first action")).toBeLessThan(
      brief.indexOf("## Current state")
    );
    expect(brief).toMatchInlineSnapshot(`
      "# AgentCarry Continuation Brief

      ## First action
      - Write the focused test. [evidence: event:1, event:3]

      ## Forbidden before first action
      - Change public exports. [evidence: event:3]

      ## Constraints
      - Do not change exports. [evidence: event:3]

      ## Current state
      - Objective: Fix the parser. [evidence: event:2]

      ## Later actions
      - None evidenced.

      ## Validations
      - None evidenced.

      ## Commands already run
      - None evidenced.

      ## Transfer losses
      - INFO HIDDEN_AGENT_STATE_UNAVAILABLE: Hidden state is not transferable.

      ## Workspace
      - Root: C:\\Users\\dev\\中文 项目
      "
    `);
  });

  it("seeds Claude with the brief instead of duplicated canonical JSON", () => {
    const prompt = buildContinuationPrompt(capsule);

    expect(prompt).toContain(renderContinuationBrief(capsule));
    expect(prompt).toContain("Start with the First action");
    expect(prompt).toContain("Do not perform any Forbidden before first action item early");
    expect(prompt).not.toContain("Canonical capsule");
    expect(prompt).not.toContain('"schemaVersion"');
  });

  it("keeps failed paths in the brief without embedding the full Capsule", () => {
    const withFailure = {
      ...capsule,
      completed: [{
        text: "Disabled the cache.",
        evidenceRefs: ["event:3"],
        inferred: false
      }],
      failedAttempts: [{
        attempt: "Disabled the cache.",
        outcome: "The failing total did not change.",
        evidenceRefs: ["event:3"],
        inferred: false
      }]
    } satisfies WorkCapsule;

    const brief = renderContinuationBrief(withFailure);

    expect(brief.match(/Disabled the cache\./g)).toHaveLength(1);
    expect(brief).toContain("Failed outcome: The failing total did not change. [evidence: event:3]");
    expect(brief).not.toContain('"failedAttempts"');
  });

  it("keeps compact Git, file, command, and validation state", () => {
    const withWorkspaceState = {
      ...capsule,
      workspace: {
        ...capsule.workspace,
        git: { repoRoot: "C:\\Users\\dev\\中文 项目", branch: "agent/38", head: "abc123", dirty: true }
      },
      files: [{ path: "src/parser.ts", kind: "modified", evidenceRefs: ["event:3"] }],
      commands: [{ command: "npm test", cwd: "C:\\Users\\dev\\中文 项目", exitCode: 1, evidenceRefs: ["event:3"] }],
      validations: [{ name: "npm test", status: "failed", summary: "One regression failed.", evidenceRefs: ["event:3"] }]
    } satisfies WorkCapsule;

    const brief = renderContinuationBrief(withWorkspaceState);

    expect(brief).toContain("Git: branch=agent/38; head=abc123; dirty=true");
    expect(brief).toContain("File: modified src/parser.ts [evidence: event:3]");
    expect(brief).toContain("Command: `npm test` (cwd: C:\\Users\\dev\\中文 项目; exit: 1) [evidence: event:3]");
    expect(brief).toContain("Validation: FAILED npm test — One regression failed. [evidence: event:3]");
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

