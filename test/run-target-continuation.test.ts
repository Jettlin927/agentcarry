import { stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildVisibleTranscript, type BenchmarkSourceFixture } from "../src/benchmark/build-handoff-input.js";
import {
  createTargetInvocation,
  runTargetContinuation,
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
    expect(invocation.settings).toBe(targetSettings);
  });

  it("records raw output and all exact input-token categories", async () => {
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
      now: () => times.shift()!
    });

    expect(result).toMatchObject({
      runId: `${fixture.id}:visible-transcript:initial`,
      target: { agent: "claude", model: "fixed-model", settings: targetSettings },
      input: { exactTargetInputTokens: 66 },
      output: { text: "Objective retained. Next action: run the focused regression." },
      invocation: {
        startedAt: "2026-07-21T00:00:00.000Z",
        completedAt: "2026-07-21T00:00:01.000Z"
      }
    });
    await expect(stat(temporaryCwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports process failure without retrying or managing authentication", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "authentication required"
    }));

    await expect(runTargetContinuation(buildVisibleTranscript(fixture), "fixed-model", {
      runner
    })).rejects.toThrow("target continuation failed (1): authentication required");
    expect(runner).toHaveBeenCalledOnce();
  });
});
