import { stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  buildDeterministicCapsule,
  buildVisibleTranscript,
  type BenchmarkSourceFixture
} from "../src/benchmark/build-handoff-input.js";
import {
  createTargetCalibrationInvocation,
  createTargetSettings,
  createTargetInvocation,
  runTargetCalibration,
  runTargetContinuation,
  runCanonicalCapsuleMeasurement,
  targetPayload,
  targetSettings
} from "../src/benchmark/run-target-continuation.js";
import type { ProcessRunner } from "../src/benchmark/run-source-assisted.js";

const fixture = JSON.parse(readFileSync(fileURLToPath(
  new URL("../benchmark/fixtures/debugging-01-invoice-total.json", import.meta.url)
), "utf8")) as BenchmarkSourceFixture;

describe("target continuation runner", () => {
  it("creates a fresh fixed no-tools and no-persistence invocation", () => {
    const invocation = createTargetInvocation(buildVisibleTranscript(fixture), "fixed-model");

    expect(invocation.args).toEqual(expect.arrayContaining([
      "--print",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--max-turns",
      "1",
      "--model",
      "fixed-model"
    ]));
    expect(invocation.args).not.toContain("--resume");
    expect(invocation.args).not.toContain("--continue");
    expect(invocation.args[invocation.args.indexOf("--tools") + 1]).toBe("");
    expect(invocation.args[invocation.args.indexOf("--setting-sources") + 1]).toBe("");
    expect(invocation.settings).toEqual(targetSettings);
  });

  it("loads only explicit user settings for a declared provider route", () => {
    const invocation = createTargetInvocation(
      buildVisibleTranscript(fixture),
      "routed-model",
      { settingSources: "user" }
    );

    expect(invocation.args[invocation.args.indexOf("--setting-sources") + 1]).toBe("user");
    expect(invocation.settings).toEqual(createTargetSettings("user"));
  });

  it("sends the compact continuation brief while retaining the canonical capsule", () => {
    const artifact = buildDeterministicCapsule(fixture);
    const invocation = createTargetInvocation(artifact, "fixed-model");

    expect(artifact.content).toContain('"schemaVersion": "2.0.0"');
    expect(invocation.payload).toBe(targetPayload(artifact));
    expect(invocation.payload).toContain("## First action");
    expect(invocation.payload).not.toContain('"schemaVersion"');
    expect(invocation.stdin).toContain(invocation.payload);
  });

  it("measures fixed target overhead with an empty AgentCarry payload", async () => {
    const invocation = createTargetCalibrationInvocation("fixed-model");
    expect(invocation.payload).toBe("");

    const calibration = await runTargetCalibration("fixed-model", {
      runner: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ result: "No handoff supplied.", usage: { input_tokens: 100 } }),
        stderr: ""
      }),
      provider: "test-provider",
      now: () => new Date("2026-07-21T00:00:00Z")
    });

    expect(calibration).toMatchObject({
      schemaVersion: "2.0.0",
      target: { model: "fixed-model", provider: "test-provider" },
      input: { exactInputTokens: 100 }
    });
  });

  it("records full-call, calibrated overhead, and AgentCarry payload tokens", async () => {
    let temporaryCwd = "";
    const runner: ProcessRunner = vi.fn(async (_command, _args, options) => {
      temporaryCwd = options.cwd;
      expect(options.stdin).toContain("HANDOFF INPUT");
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          result: "Objective retained. Next action: run the focused regression.",
          usage: {
            input_tokens: 11,
            cache_creation_input_tokens: 22,
            cache_read_input_tokens: 33
          }
        }),
        stderr: ""
      };
    });
    const times = [
      new Date("2026-07-21T00:00:00Z"),
      new Date("2026-07-21T00:00:01Z")
    ];

    const result = await runTargetContinuation(buildVisibleTranscript(fixture), "fixed-model", {
      runner,
      provider: "test-provider",
      calibration: {
        schemaVersion: "2.0.0",
        target: {
          agent: "claude",
          model: "fixed-model",
          provider: "test-provider",
          settings: {
            systemPromptSha256: targetSettings.systemPromptSha256,
            settingSources: "none",
            mcp: "empty-strict",
            slashCommands: "disabled",
            persistence: "disabled",
            tools: "disabled",
            maxTurns: 1,
            permissionMode: "plan"
          }
        },
        input: {
          promptSha256: "a".repeat(64),
          promptUtf8Bytes: 100,
          exactInputTokens: 26
        },
        invocation: {
          startedAt: "2026-07-21T00:00:00Z",
          completedAt: "2026-07-21T00:00:01Z"
        }
      },
      now: () => times.shift()!
    });

    expect(result).toMatchObject({
      runId: `${fixture.id}:visible-transcript:initial`,
      target: {
        agent: "claude",
        model: "fixed-model",
        provider: "test-provider",
        settings: targetSettings
      },
      schemaVersion: "2.0.0",
      input: {
        fullCallInputTokens: 66,
        fixedOverheadInputTokens: 26,
        agentCarryPayload: { tokens: 40, text: buildVisibleTranscript(fixture).content }
      },
      output: { text: "Objective retained. Next action: run the focused regression." },
      invocation: {
        startedAt: "2026-07-21T00:00:00.000Z",
        completedAt: "2026-07-21T00:00:01.000Z"
      }
    });
    await expect(stat(temporaryCwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("measures canonical Work Capsule payload with the same calibrated target", async () => {
    const artifact = buildDeterministicCapsule(fixture);
    const measurement = await runCanonicalCapsuleMeasurement(artifact, "fixed-model", {
      runner: async (_command, _args, options) => {
        expect(options.stdin).toContain(artifact.content);
        return {
          exitCode: 0,
          stdout: JSON.stringify({ result: "Measured.", usage: { input_tokens: 140 } }),
          stderr: ""
        };
      },
      provider: "test-provider",
      calibration: {
        schemaVersion: "2.0.0",
        target: {
          agent: "claude",
          model: "fixed-model",
          provider: "test-provider",
          settings: targetSettings
        },
        input: {
          promptSha256: "a".repeat(64),
          promptUtf8Bytes: 100,
          exactInputTokens: 100
        },
        invocation: {
          startedAt: "2026-07-21T00:00:00Z",
          completedAt: "2026-07-21T00:00:01Z"
        }
      },
      now: () => new Date("2026-07-21T00:00:00Z")
    });

    expect(measurement).toMatchObject({
      fixtureId: fixture.id,
      mode: "deterministic-capsule",
      purpose: "canonical-work-capsule-baseline",
      input: {
        fullCallInputTokens: 140,
        fixedOverheadInputTokens: 100,
        canonicalWorkCapsulePayload: { tokens: 40 }
      }
    });
  });

  it("does not define a canonical Capsule baseline for visible transcripts", async () => {
    await expect(runCanonicalCapsuleMeasurement(
      buildVisibleTranscript(fixture),
      "fixed-model"
    )).rejects.toThrow("requires a capsule mode");
  });

  it("rejects missing calibration before invoking the target", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ result: "Unexpected", usage: { input_tokens: 10 } }),
      stderr: ""
    }));

    await expect(runTargetContinuation(buildVisibleTranscript(fixture), "fixed-model", {
      runner
    })).rejects.toThrow("requires fixed-overhead calibration");
    expect(runner).not.toHaveBeenCalled();
  });

  it("reports process failure without retrying or managing authentication", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "authentication required"
    }));

    await expect(runTargetContinuation(buildVisibleTranscript(fixture), "fixed-model", {
      runner,
      calibration: {
        schemaVersion: "2.0.0",
        target: {
          agent: "claude",
          model: "fixed-model",
          provider: "unspecified",
          settings: targetSettings
        },
        input: {
          promptSha256: "a".repeat(64),
          promptUtf8Bytes: 100,
          exactInputTokens: 10
        },
        invocation: {
          startedAt: "2026-07-21T00:00:00Z",
          completedAt: "2026-07-21T00:00:01Z"
        }
      }
    })).rejects.toThrow("target continuation failed (1): authentication required");
    expect(runner).toHaveBeenCalledOnce();
  });
});
