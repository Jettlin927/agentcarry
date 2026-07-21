import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  finalizeBenchmarkReview,
  renderReviewPacket,
  type AdvisoryVerdictSet,
  type ReviewFixture
} from "../src/benchmark/review-materialization.js";
import { targetSettings, type TargetRunResult } from "../src/benchmark/run-target-continuation.js";

const fixtureDirectory = fileURLToPath(new URL("../benchmark/fixtures/", import.meta.url));
const fixtures = readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(fixtureDirectory, name), "utf8")) as ReviewFixture);
const modes = [
  "visible-transcript",
  "deterministic-capsule",
  "source-assisted-capsule"
] as const;

function result(
  fixture: ReviewFixture,
  mode: TargetRunResult["mode"]
): TargetRunResult {
  const runId = `${fixture.id}:${mode}:initial`;
  return {
    schemaVersion: "1.0.0",
    runId,
    fixtureId: fixture.id,
    mode,
    sourceFingerprint: "a".repeat(64),
    target: {
      agent: "claude",
      model: "review-test-model",
      provider: "review-test-provider",
      settings: targetSettings
    },
    input: {
      sha256: "b".repeat(64),
      utf8Bytes: 100,
      exactTargetInputTokens: mode === "visible-transcript" ? 1_000 : 300
    },
    output: {
      text: `Target continuation for ${runId}`,
      sha256: "c".repeat(64)
    },
    invocation: {
      promptSha256: "b".repeat(64),
      startedAt: "2026-07-21T00:00:00Z",
      completedAt: "2026-07-21T00:00:01Z"
    }
  };
}

const results = fixtures.flatMap((fixture) => modes.map((mode) => result(fixture, mode)));

function advisory(): AdvisoryVerdictSet {
  return {
    schemaVersion: "1.0.0",
    benchmarkId: "first-36",
    status: "advisory-only-pending-human-review",
    reviewer: {
      kind: "llm",
      name: "test-advisory-model",
      advisoryOnly: true,
      reviewedAt: "2026-07-21T01:00:00Z"
    },
    defaultVerdict: "preserved",
    defaultRepeatedFailedPaths: [],
    defaultUnsupportedClaims: [],
    instructions: "Human review is required.",
    runs: results.map((entry) => ({ runId: entry.runId, exceptions: {} }))
  };
}

const confirmation = {
  confirmed: true as const,
  humanReviewer: "human-reviewer",
  reviewedAt: "2026-07-21T02:00:00Z",
  confirmationSource: "https://github.com/example/repo/issues/5#issuecomment-1"
};

describe("benchmark review materialization", () => {
  it("materializes all assessments, deterministic scores, and the aggregate report", () => {
    const materialized = finalizeBenchmarkReview(fixtures, results, advisory(), confirmation);

    expect(materialized.assessments).toHaveLength(36);
    expect(materialized.scores).toHaveLength(36);
    expect(materialized.resultSet.reports).toHaveLength(36);
    expect(materialized.report.phase0Passed).toBe(true);
    expect(materialized.report.target).toMatchObject({
      model: "review-test-model",
      provider: "review-test-provider"
    });
    expect(materialized.assessments[0]?.review).toEqual({
      humanReviewer: "human-reviewer",
      reviewedAt: "2026-07-21T02:00:00Z",
      llmJudge: { model: "test-advisory-model", advisoryOnly: true }
    });
    expect(materialized.confirmation.confirmationSource).toContain("issuecomment-1");
  });

  it("applies explicit exceptions and rejects unknown fact ids", () => {
    const fixture = fixtures[0]!;
    const runId = `${fixture.id}:visible-transcript:initial`;
    const nextActionId = fixture.groundTruth.nextAction.id;
    const input = advisory();
    const withException: AdvisoryVerdictSet = {
      ...input,
      runs: input.runs.map((run) => run.runId === runId
        ? {
            ...run,
            exceptions: {
              [nextActionId]: { verdict: "contradicted", note: "Wrong first action." }
            }
          }
        : run)
    };

    const materialized = finalizeBenchmarkReview(fixtures, results, withException, confirmation);
    const assessment = materialized.assessments.find((entry) => entry.runId === runId)!;
    expect(assessment.categories.nextAction).toEqual([{
      factId: nextActionId,
      verdict: "contradicted",
      note: "Wrong first action."
    }]);

    const invalid: AdvisoryVerdictSet = {
      ...input,
      runs: input.runs.map((run, index) => index === 0
        ? {
            ...run,
            exceptions: {
              unknown: { verdict: "missing", note: "Unknown fact." }
            }
          }
        : run)
    };
    expect(() => finalizeBenchmarkReview(fixtures, results, invalid, confirmation)).toThrow(
      "unknown fact id unknown"
    );
  });

  it("renders one human-review packet containing outputs and every fact", () => {
    const packet = renderReviewPacket(fixtures, results, advisory());

    expect(packet).toContain("HUMAN REVIEW REQUIRED");
    expect(packet).toContain("Target continuation for architecture-01-streaming-log");
    expect(packet).toContain(fixtures[0]!.groundTruth.nextAction.id);
    expect(packet).toContain("- [ ] Human checked every fact and the target output for this run.");
  });
});
