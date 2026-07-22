import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDeterministicCapsule,
  buildSourceAssistedPrompt,
  sourceAssistedArtifact,
  type BenchmarkSourceFixture,
  type HandoffInputArtifact
} from "../src/benchmark/build-handoff-input.js";
import {
  collectTargetRuns,
  createBenchmarkRunPlan
} from "../src/benchmark/collect-target-runs.js";
import {
  createTargetCalibrationInvocation,
  createCanonicalCapsuleMeasurementInvocation,
  createTargetInvocation,
  createTargetSettings,
  targetSettings,
  type CanonicalCapsuleMeasurement,
  type TargetCalibration,
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
    100,
    buildSourceAssistedPrompt(fixture)
  );
}

function targetResult(
  artifact: HandoffInputArtifact,
  model: string,
  calibration: TargetCalibration,
  provider = "unspecified"
): TargetRunResult {
  const invocation = createTargetInvocation(artifact, model);
  const outputText = "Reviewed continuation state.";
  return {
    schemaVersion: "2.0.0",
    runId: `${artifact.fixtureId}:${artifact.mode}:initial`,
    fixtureId: artifact.fixtureId,
    mode: artifact.mode,
    sourceFingerprint: artifact.sourceFingerprint,
    target: { agent: "claude", model, provider, settings: targetSettings },
    input: {
      promptSha256: createHash("sha256").update(invocation.stdin, "utf8").digest("hex"),
      promptUtf8Bytes: Buffer.byteLength(invocation.stdin, "utf8"),
      fullCallInputTokens: calibration.input.exactInputTokens + 50,
      fixedOverheadInputTokens: calibration.input.exactInputTokens,
      agentCarryPayload: {
        contentType: artifact.mode === "visible-transcript" ? artifact.contentType : "text/markdown",
        text: invocation.payload,
        sha256: createHash("sha256").update(invocation.payload, "utf8").digest("hex"),
        utf8Bytes: Buffer.byteLength(invocation.payload, "utf8"),
        tokens: 50
      }
    },
    output: {
      text: outputText,
      sha256: createHash("sha256").update(outputText, "utf8").digest("hex")
    },
    invocation: {
      promptSha256: createHash("sha256").update(invocation.stdin, "utf8").digest("hex"),
      startedAt: "2026-07-21T00:00:00Z",
      completedAt: "2026-07-21T00:00:01Z"
    }
  };
}

function calibration(
  model = "fixed-model",
  provider = "unspecified",
  settingSources: "none" | "user" = "none"
): TargetCalibration {
  const invocation = createTargetCalibrationInvocation(model, { settingSources });
  return {
    schemaVersion: "2.0.0",
    target: {
      agent: "claude",
      model,
      provider,
      settings: createTargetSettings(settingSources)
    },
    input: {
      promptSha256: createHash("sha256").update(invocation.stdin, "utf8").digest("hex"),
      promptUtf8Bytes: Buffer.byteLength(invocation.stdin, "utf8"),
      exactInputTokens: 1_000
    },
    invocation: {
      startedAt: "2026-07-21T00:00:00Z",
      completedAt: "2026-07-21T00:00:01Z"
    }
  };
}

function canonicalMeasurement(
  artifact: HandoffInputArtifact,
  model: string,
  targetCalibration: TargetCalibration
): Promise<CanonicalCapsuleMeasurement> {
  if (artifact.mode === "visible-transcript") {
    throw new Error("test canonical measurement requires a capsule mode");
  }
  const invocation = createCanonicalCapsuleMeasurementInvocation(artifact, model);
  return Promise.resolve({
    schemaVersion: "2.0.0",
    fixtureId: artifact.fixtureId,
    mode: artifact.mode,
    purpose: "canonical-work-capsule-baseline",
    sourceFingerprint: artifact.sourceFingerprint,
    target: { agent: "claude", model, provider: "unspecified", settings: targetSettings },
    input: {
      promptSha256: createHash("sha256").update(invocation.stdin, "utf8").digest("hex"),
      promptUtf8Bytes: Buffer.byteLength(invocation.stdin, "utf8"),
      fullCallInputTokens: targetCalibration.input.exactInputTokens + 125,
      fixedOverheadInputTokens: targetCalibration.input.exactInputTokens,
      canonicalWorkCapsulePayload: {
        sha256: createHash("sha256").update(artifact.content, "utf8").digest("hex"),
        utf8Bytes: Buffer.byteLength(artifact.content, "utf8"),
        tokens: 125
      }
    },
    responseSha256: "f".repeat(64),
    invocation: {
      startedAt: "2026-07-21T00:00:00Z",
      completedAt: "2026-07-21T00:00:01Z"
    }
  });
}

describe("benchmark target collection", () => {
  it("builds one deterministic 12 by 3 plan with fixed target settings", () => {
    const plan = createBenchmarkRunPlan([...fixtures].reverse(), "fixed-model");

    expect(plan.runs).toHaveLength(36);
    expect(plan).toMatchObject({ schemaVersion: "2.0.0", benchmarkId: "second-36" });
    expect(plan.metering).toMatchObject({
      method: "target-calibration-delta-v1",
      calibrationPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      calibrationPromptUtf8Bytes: expect.any(Number)
    });
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
    const measureCanonicalCapsule = vi.fn(canonicalMeasurement);
    const runTarget = vi.fn(async (artifact: HandoffInputArtifact, model: string) =>
      targetResult(artifact, model, calibration(model)));
    const calibrateTarget = vi.fn(async (model: string) => calibration(model));

    const first = await collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted,
      measureCanonicalCapsule,
      calibrateTarget,
      runTarget
    });
    const second = await collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted,
      measureCanonicalCapsule,
      calibrateTarget,
      runTarget
    });

    expect(first).toMatchObject({ planned: 36, completed: 36, skipped: 0 });
    expect(second).toMatchObject({ planned: 36, completed: 0, skipped: 36 });
    expect(buildSourceAssisted).toHaveBeenCalledTimes(12);
    expect(runTarget).toHaveBeenCalledTimes(36);
    expect(measureCanonicalCapsule).toHaveBeenCalledTimes(24);
    expect(calibrateTarget).toHaveBeenCalledTimes(1);
    expect(await readdir(join(root, "inputs"))).toHaveLength(36);
    expect(await readdir(join(root, "results"))).toHaveLength(36);
    expect(await readdir(join(root, "canonical-baselines"))).toHaveLength(24);
  });

  it("preserves completed runs and the generated input after a later failure", async () => {
    const root = await outputRoot("resume");
    let calls = 0;
    const failingTarget = vi.fn(async (artifact: HandoffInputArtifact, model: string) => {
      calls += 1;
      if (calls === 3) {
        throw new Error("simulated provider failure");
      }
      return targetResult(artifact, model, calibration(model));
    });

    await expect(collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted: sourceAssisted,
      measureCanonicalCapsule: canonicalMeasurement,
      calibrateTarget: async (model) => calibration(model),
      runTarget: failingTarget
    })).rejects.toThrow("simulated provider failure");
    expect(await readdir(join(root, "results"))).toHaveLength(2);
    expect(await readdir(join(root, "inputs"))).toHaveLength(3);

    const resumed = await collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted: sourceAssisted,
      measureCanonicalCapsule: canonicalMeasurement,
      calibrateTarget: async (model) => calibration(model),
      runTarget: async (artifact, model) => targetResult(artifact, model, calibration(model))
    });
    expect(resumed).toMatchObject({ planned: 36, completed: 34, skipped: 2 });
    expect(await readdir(join(root, "results"))).toHaveLength(36);
  });

  it("refuses to mix models with an existing plan", async () => {
    const root = await outputRoot("model");
    await collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted: sourceAssisted,
      measureCanonicalCapsule: canonicalMeasurement,
      calibrateTarget: async (model) => calibration(model),
      runTarget: async (artifact, model) => targetResult(artifact, model, calibration(model))
    });

    await expect(collectTargetRuns(fixtures, "different-model", root, {
      buildSourceAssisted: sourceAssisted,
      measureCanonicalCapsule: canonicalMeasurement,
      calibrateTarget: async (model) => calibration(model),
      runTarget: async (artifact, model) => targetResult(artifact, model, calibration(model))
    })).rejects.toThrow("existing benchmark plan differs");
  });

  it("rejects a tampered stored calibration before resuming target runs", async () => {
    const root = await outputRoot("calibration-integrity");
    await collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted: sourceAssisted,
      measureCanonicalCapsule: canonicalMeasurement,
      calibrateTarget: async (model) => calibration(model),
      runTarget: async (artifact, model) => targetResult(artifact, model, calibration(model))
    });
    const calibrationPath = join(root, "calibration.json");
    const stored = JSON.parse(await readFile(calibrationPath, "utf8")) as TargetCalibration;
    await writeFile(calibrationPath, JSON.stringify({
      ...stored,
      input: { ...stored.input, promptSha256: "f".repeat(64) }
    }), "utf8");
    const calibrateTarget = vi.fn(async (model: string) => calibration(model));
    const runTarget = vi.fn(async (
      artifact: HandoffInputArtifact,
      model: string,
      targetCalibration: TargetCalibration
    ) => targetResult(artifact, model, targetCalibration));

    await expect(collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted: sourceAssisted,
      measureCanonicalCapsule: canonicalMeasurement,
      calibrateTarget,
      runTarget
    })).rejects.toThrow("stored target calibration does not match the benchmark plan");
    expect(calibrateTarget).not.toHaveBeenCalled();
    expect(runTarget).not.toHaveBeenCalled();
  });

  it("rejects a stored target result whose hashed output was tampered", async () => {
    const root = await outputRoot("result-integrity");
    await collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted: sourceAssisted,
      measureCanonicalCapsule: canonicalMeasurement,
      calibrateTarget: async (model) => calibration(model),
      runTarget: async (artifact, model) => targetResult(artifact, model, calibration(model))
    });
    const resultPath = join(
      root,
      "results",
      "architecture-01-streaming-log--visible-transcript.json"
    );
    const stored = JSON.parse(await readFile(resultPath, "utf8")) as TargetRunResult;
    await writeFile(resultPath, JSON.stringify({
      ...stored,
      output: { ...stored.output, text: `${stored.output.text} tampered` }
    }), "utf8");

    await expect(collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted: sourceAssisted,
      measureCanonicalCapsule: canonicalMeasurement,
      calibrateTarget: async (model) => calibration(model),
      runTarget: async (artifact, model) => targetResult(artifact, model, calibration(model))
    })).rejects.toThrow(
      "stored target result does not match run plan for architecture-01-streaming-log:visible-transcript:initial"
    );
  });

  it("rejects a canonical baseline whose measured prompt hash was tampered", async () => {
    const root = await outputRoot("canonical-prompt-integrity");
    await collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted: sourceAssisted,
      measureCanonicalCapsule: canonicalMeasurement,
      calibrateTarget: async (model) => calibration(model),
      runTarget: async (artifact, model) => targetResult(artifact, model, calibration(model))
    });
    const baselinePath = join(
      root,
      "canonical-baselines",
      "architecture-01-streaming-log--deterministic-capsule.json"
    );
    const stored = JSON.parse(await readFile(baselinePath, "utf8")) as CanonicalCapsuleMeasurement;
    await writeFile(baselinePath, JSON.stringify({
      ...stored,
      input: { ...stored.input, promptSha256: "0".repeat(64) }
    }), "utf8");

    await expect(collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted: sourceAssisted,
      measureCanonicalCapsule: canonicalMeasurement,
      calibrateTarget: async (model) => calibration(model),
      runTarget: async (artifact, model) => targetResult(artifact, model, calibration(model))
    })).rejects.toThrow(
      "stored canonical baseline does not match architecture-01-streaming-log:deterministic-capsule"
    );
  });

  it("rejects a stored source-assisted artifact that is not Work Capsule v2", async () => {
    const root = await outputRoot("source-assisted-integrity");
    await collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted: sourceAssisted,
      measureCanonicalCapsule: canonicalMeasurement,
      calibrateTarget: async (model) => calibration(model),
      runTarget: async (artifact, model) => targetResult(artifact, model, calibration(model))
    });
    const inputPath = join(
      root,
      "inputs",
      "architecture-01-streaming-log--source-assisted-capsule.json"
    );
    const stored = JSON.parse(await readFile(inputPath, "utf8")) as HandoffInputArtifact;
    const invalidContent = JSON.stringify({
      schemaVersion: "work-capsule/v1",
      nextAction: { first: { action: "Continue." } }
    });
    await writeFile(inputPath, JSON.stringify({
      ...stored,
      content: invalidContent,
      measurements: {
        ...stored.measurements,
        utf8Bytes: Buffer.byteLength(invalidContent, "utf8"),
        unicodeCodePoints: [...invalidContent].length
      }
    }), "utf8");
    const buildSourceAssisted = vi.fn(sourceAssisted);
    const runTarget = vi.fn(async (
      artifact: HandoffInputArtifact,
      model: string,
      targetCalibration: TargetCalibration
    ) => targetResult(artifact, model, targetCalibration));

    await expect(collectTargetRuns(fixtures, "fixed-model", root, {
      buildSourceAssisted,
      measureCanonicalCapsule: canonicalMeasurement,
      calibrateTarget: async (model) => calibration(model),
      runTarget
    })).rejects.toThrow(
      "stored capsule input is not Work Capsule v2 for architecture-01-streaming-log:source-assisted-capsule:initial"
    );
    expect(buildSourceAssisted).not.toHaveBeenCalled();
    expect(runTarget).not.toHaveBeenCalled();
  });
});
