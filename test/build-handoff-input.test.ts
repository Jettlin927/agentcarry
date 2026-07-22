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

function readFixtureById(id: string): BenchmarkSourceFixture {
  const path = fileURLToPath(new URL(`../benchmark/fixtures/${id}.json`, import.meta.url));
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
      new URL("../schema/work-capsule.v2.schema.json", import.meta.url)
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

  it.each([
    ["architecture-01-streaming-log", "a01-tool-2", "Investigate and resolve the latest source result: Throughput meets the target, but the slow-consumer backpressure test hangs."],
    ["architecture-02-session-index", "a02-tool-2", "Investigate and resolve the latest source result: Update churn grows the file indefinitely; compaction and crash-safe replacement are not implemented."],
    ["architecture-03-job-scheduler", "a03-tool-2", "Investigate and resolve the latest source result: Cancelling the second queued job still starts it after the first running job releases a slot."],
    ["debugging-01-invoice-total", "d01-user-2", "Prove the parser fix with a regression test."],
    ["debugging-02-unicode-watcher", "d02-user-2", "Add the Windows integration test."],
    ["debugging-03-duplicate-jobs", "d03-user-2", "Add the fake-clock regression."],
    ["feature-01-pagination", "f01-user-2", "Expose an async iterator named pages(); each next() should fetch exactly one page."],
    ["feature-02-deploy-dry-run", "f02-user-2", "Wire --dry-run into the CLI and assert the executor is never constructed."],
    ["feature-03-config-errors", "f03-user-2", "Redact at the validation-error formatter, not in the parser, and preserve the failing field path."],
    ["refactor-01-http-transport", "r01-user-2", "Header preservation belongs inside the transport. The streaming response method is still unconverted."],
    ["refactor-02-cli-renderers", "r02-user-2", "Renderers own formatting. Diagnostics go to stderr; do not special-case commands."],
    ["refactor-03-file-indexer", "r03-user-2", "The remaining work is .ignore-file support. Keep ignore parsing inside the local indexer."]
  ])("builds the reviewed first action and evidence for %s", (fixtureId, evidenceId, firstText) => {
    const fixtureUnderTest = readFixtureById(fixtureId);
    const capsule = JSON.parse(buildDeterministicCapsule(fixtureUnderTest).content) as {
      nextAction: {
        first: { text: string; evidenceRefs: string[]; inferred: boolean };
        then: unknown[];
        forbiddenBefore: unknown[];
      };
    };

    expect(capsule.nextAction.first.text).toBe(firstText);
    expect(capsule.nextAction.first.evidenceRefs).toEqual([evidenceId]);
  });

  it("keeps an explicitly later action behind the first action", () => {
    const orderedFixture = readFixtureById("debugging-03-duplicate-jobs");
    const capsule = JSON.parse(buildDeterministicCapsule(orderedFixture).content) as {
      nextAction: {
        first: { text: string; evidenceRefs: string[]; inferred: boolean };
        then: Array<{ text: string }>;
        forbiddenBefore: Array<{ text: string; evidenceRefs: string[]; inferred: boolean }>;
      };
    };

    expect(capsule.nextAction.first).toEqual({
      text: "Add the fake-clock regression.",
      evidenceRefs: ["d03-user-2"],
      inferred: true
    });
    expect(capsule.nextAction.then).toEqual([]);
    expect(capsule.nextAction.forbiddenBefore).toEqual([{
      text: "Touch retry policy.",
      evidenceRefs: ["d03-user-2"],
      inferred: true
    }]);
  });

  it("rejects a next action without source evidence", () => {
    const capsule = JSON.parse(buildDeterministicCapsule(fixture).content) as {
      nextAction: { first: { evidenceRefs: string[] } };
    };
    capsule.nextAction.first.evidenceRefs = [];
    const schemaPath = fileURLToPath(
      new URL("../schema/work-capsule.v2.schema.json", import.meta.url)
    );
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat("date-time", {
      type: "string",
      validate: (value: string) => !Number.isNaN(Date.parse(value))
    });

    expect(ajv.compile(schema)(capsule)).toBe(false);
  });

  it("never includes benchmark ground truth in the source-assisted prompt", () => {
    const prompt = buildSourceAssistedPrompt(fixture);

    expect(prompt).not.toContain("groundTruth");
    expect(prompt).not.toContain("d01-constraint-api");
    expect(prompt).toContain("d01-tool-1");
    expect(prompt).toContain("Set nextAction.first to the single action the target must do first");
    expect(prompt).toContain("Do not promote nextAction.then before nextAction.first is complete");
    expect(prompt).toContain("Record explicitly blocked early actions in nextAction.forbiddenBefore");
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
    expect(invocation.args[invocation.args.indexOf("--setting-sources") + 1]).toBe("");
    const capsuleSchema = JSON.parse(
      invocation.args[invocation.args.indexOf("--json-schema") + 1]!
    ) as { properties: { schemaVersion: { const: string } }; required: string[] };
    expect(capsuleSchema.properties.schemaVersion.const).toBe("2.0.0");
    expect(capsuleSchema.required).toContain("nextAction");
  });

  it("can explicitly load trusted user settings without enabling tools or persistence", async () => {
    const invocation = await createSourceAssistedInvocation(
      fixture,
      "routed-model",
      { settingSources: "user" }
    );

    expect(invocation.args[invocation.args.indexOf("--setting-sources") + 1]).toBe("user");
    expect(invocation.args[invocation.args.indexOf("--tools") + 1]).toBe("");
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
          usage: {
            input_tokens: 321,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 20
          }
        }),
        stderr: ""
      };
    };

    const artifact = await runSourceAssisted(fixture, "controlled-model", runner);

    expect(artifact.generation.summarizerInputTokens).toBe(351);
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
