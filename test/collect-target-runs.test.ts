import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDeterministicCapsule,
  sourceAssistedArtifact,
  type BenchmarkSourceFixture,
  type HandoffInputArtifact
} from "../src/benchmark/build-handoff-input.js";
import {
  collectTargetRuns,
  createBenchmarkRunPlan
} from "../src/benchmark/collect-target-runs.js";
import {
  createTargetSettings,
  targetSettings,
  type TargetRunResult
} from "../src/benchmark/run-target-continuation.js";

const fixtureDirectory = fileURLToPath(new URL("../benchmark/fixtures/", import.meta.url));
const fixtures = readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(fixtureDirectory, name), "utf8")) as BenchmarkSourceFixture);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function outputRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `agentcarry-${name}-`));
  temporaryRoots.push(root);
  return join(root, "中文 results");
}

async function sourceAssisted(
  fixture: BenchmarkSourceFixture,
  model: string
): Promise<HandoffInputArtifact> {
  return sourceAssistedArtifact(
    fixture,
    model,
    JSON.parse(buildDeterministicCapsule(fixture).content) as unknown,
    100
  );
}

function targetResult(
  artifact: HandoffInputArtifact,
  model: string,
  provider = "unspecified"
): TargetRunResult {
  return {
    schemaVersion: "1.0.0",
    runId: `${artifact.fixtureId}:${artifact.mode}:initial`,
    fixtureId: artifact.fixtureId,
    mode: artifact.mode,
    sourceFingerprint: artifact.sourceFingerprint,
    target: { agent: "claude", model, provider, settings: targetSettings },
    input: { sha256: "a".repeat(64), utf8Bytes: 100, exactTargetInputTokens: 50 },
    output: { text: "Reviewed continuation state.", sha256: "b".repeat(64) },
    invocation: {
      promptSha256: "a".repeat(64),
      startedAt: "2026-07-21T00:00:00Z",
      completedAt: "2026-07-21T00:00:01Z"
    }
  };
}

describe("benchmark target collection", () => {
  it("builds one deterministic 12 by 3 plan with fixed target settings", () => {
    const plan = createBenchmarkRunPlan([...fixtures].reverse(), "fixed-model");

    expect(plan.runs).toHaveLength(36);
    expect(new Set(plan.runs.map((run) => `${run.fixtureId}:${run.mode}`))).toHaveLength(36);
    expect(plan.target).toEqual({
      agent: "claude",
      model: "fixed-model",
      provider: "unspecified",
      settings: targetSettings
    });
    expect(plan.runs[0]?.fixtureId.localeCompare(plan.runs.at(-1)!.fixtureId)).toBeLessThan(0);
  });

  it("records an explicit routed provider and its user-setting dependency", () => {
    const plan = createBenchmarkRunPlan(fixtures, "gpt-5.6-sol", {
      provider: "cc-switch-codex-oauth",
      settingSources: "user"
    });

    expect(plan.target).toEqual({
      agent: "claude",
      model: "gpt-5.6-sol",
      provider: "cc-switch-codex-oauth",
      settings: createTargetSettings("user")
    });
  });

  it("collects every raw result once and resumes without overwriting", async () => {
    const root = await outputRoot("collect");
    const buildSourceAssisted = vi.fn(sourceAssisted);
    const runTarget = vi.fn(async (artifact: HandoffInputArtifact, model: string) =>
      targetResult(artifact, model));

    const first = await collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted,
      runTarget
    });
    const second = await collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted,
      runTarget
    });

    expect(first).toMatchObject({ planned: 36, completed: 36, skipped: 0 });
    expect(second).toMatchObject({ planned: 36, completed: 0, skipped: 36 });
    expect(buildSourceAssisted).toHaveBeenCalledTimes(12);
    expect(runTarget).toHaveBeenCalledTimes(36);
    expect(await readdir(join(root, "inputs"))).toHaveLength(36);
    expect(await readdir(join(root, "results"))).toHaveLength(36);
  });

  it("preserves completed runs and the generated input after a later failure", async () => {
    const root = await outputRoot("resume");
    let calls = 0;
    const failingTarget = vi.fn(async (artifact: HandoffInputArtifact, model: string) => {
      calls += 1;
      if (calls === 3) {
        throw new Error("simulated provider failure");
      }
      return targetResult(artifact, model);
    });

    await expect(collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted: sourceAssisted,
      runTarget: failingTarget
    })).rejects.toThrow("simulated provider failure");
    expect(await readdir(join(root, "results"))).toHaveLength(2);
    expect(await readdir(join(root, "inputs"))).toHaveLength(3);

    const resumed = await collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted: sourceAssisted,
      runTarget: async (artifact, model) => targetResult(artifact, model)
    });
    expect(resumed).toMatchObject({ planned: 36, completed: 34, skipped: 2 });
    expect(await readdir(join(root, "results"))).toHaveLength(36);
  });

  it("refuses to mix models with an existing plan", async () => {
    const root = await outputRoot("model");
    await collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted: sourceAssisted,
      runTarget: async (artifact, model) => targetResult(artifact, model)
    });

    await expect(collectTargetRuns(fixtures, "different-model", root, {
      buildSourceAssisted: sourceAssisted,
      runTarget: async (artifact, model) => targetResult(artifact, model)
    })).rejects.toThrow("existing benchmark plan differs");
  });
});
