import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  buildDeterministicCapsule,
  buildSourceAssistedPrompt,
  buildVisibleTranscript,
  recordExactTargetInputTokens,
  type BenchmarkSourceFixture
} from "../src/benchmark/build-handoff-input.js";
import {
  createSourceAssistedInvocation,
  runSourceAssisted,
  type ProcessRunner
} from "../src/benchmark/run-source-assisted.js";
import { validateFixture } from "../src/benchmark/validate-fixture.js";

function readFixture(): BenchmarkSourceFixture {
  const path = fileURLToPath(
    new URL("../benchmark/fixtures/debugging-01-invoice-total.json", import.meta.url)
  );
  return JSON.parse(readFileSync(path, "utf8")) as BenchmarkSourceFixture;
}

describe("benchmark handoff inputs", () => {
  const fixture = readFixture();

  it("builds the visible baseline from user and assistant messages only", () => {
    const artifact = buildVisibleTranscript(fixture);

    expect(artifact.content).toContain("Fix stale invoice totals");
    expect(artifact.content).toContain("The first hypothesis");
    expect(artifact.content).not.toContain("Disabling the cache");
    expect(artifact.mode).toBe("visible-transcript");
    expect(artifact.measurements.exactTargetInputTokens).toBeNull();
  });

  it("builds byte-identical deterministic capsules from source facts", () => {
    const first = buildDeterministicCapsule(fixture);
    const second = buildDeterministicCapsule(fixture);
    const capsule = JSON.parse(first.content) as { losses: Array<{ code: string }> };

    expect(first).toEqual(second);
    expect(capsule.losses.map((loss) => loss.code)).toContain(
      "DETERMINISTIC_SEMANTIC_HEURISTIC"
    );
    expect(first.sourceFingerprint).toBe(buildVisibleTranscript(fixture).sourceFingerprint);

    const schemaPath = fileURLToPath(
      new URL("../schema/work-capsule.v1.schema.json", import.meta.url)
    );
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat("date-time", {
      type: "string",
      validate: (value: string) => !Number.isNaN(Date.parse(value))
    });
    const validate = ajv.compile(schema);
    expect(validate(capsule), JSON.stringify(validate.errors)).toBe(true);
  });

  it("never includes benchmark ground truth in the source-assisted prompt", () => {
    const prompt = buildSourceAssistedPrompt(fixture);

    expect(prompt).not.toContain("groundTruth");
    expect(prompt).not.toContain("d01-constraint-api");
    expect(prompt).toContain("d01-tool-1");
  });

  it("creates a fresh no-tools, no-persistence Claude invocation", async () => {
    const invocation = await createSourceAssistedInvocation(fixture, "controlled-model");

    expect(invocation.args).toContain("--no-session-persistence");
    expect(invocation.args).toContain("--disable-slash-commands");
    expect(invocation.args).not.toContain("--resume");
    expect(invocation.args).not.toContain("--continue");
    expect(invocation.args[invocation.args.indexOf("--tools") + 1]).toBe("");
    expect(invocation.args[invocation.args.indexOf("--mcp-config") + 1]).toBe(
      '{"mcpServers":{}}'
    );
    expect(invocation.persistence).toBe("disabled");
  });

  it("records summarizer token usage without reading or mutating a source session", async () => {
    const deterministicCapsule = JSON.parse(buildDeterministicCapsule(fixture).content) as unknown;
    const runner: ProcessRunner = async (_command, _args, options) => {
      expect(options.cwd).toContain("agentcarry-benchmark-");
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          structured_output: deterministicCapsule,
          usage: { input_tokens: 321 }
        }),
        stderr: ""
      };
    };

    const artifact = await runSourceAssisted(fixture, "controlled-model", runner);

    expect(artifact.generation.summarizerInputTokens).toBe(321);
    expect(artifact.generation.persistence).toBe("disabled");
    expect(artifact.generation.tools).toBe("disabled");
  });

  it("records exact target input tokens after a target run", () => {
    const artifact = recordExactTargetInputTokens(buildVisibleTranscript(fixture), 987);

    expect(artifact.measurements.exactTargetInputTokens).toBe(987);
    expect(() => recordExactTargetInputTokens(artifact, -1)).toThrow(
      "target input tokens must be a non-negative integer"
    );
  });

  it("keeps the source fixture valid after every builder", () => {
    buildVisibleTranscript(fixture);
    buildDeterministicCapsule(fixture);
    buildSourceAssistedPrompt(fixture);

    expect(validateFixture(fixture)).toEqual({ valid: true, errors: [] });
  });
});
