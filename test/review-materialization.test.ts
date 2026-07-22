import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  finalizeBenchmarkReview,
  finalizeBenchmarkReviewFromExport,
  renderReviewPacket,
  type AdvisoryVerdictSet,
  type HumanReviewExport,
  type ReviewFixture
} from "../src/benchmark/review-materialization.js";
import {
  renderReviewHtml,
  type ReviewInputArtifact
} from "../src/benchmark/render-review-html.js";
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
  const payloadTokens = mode === "visible-transcript" ? 1_000 : 300;
  return {
    schemaVersion: "2.0.0",
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
      promptSha256: "b".repeat(64),
      promptUtf8Bytes: 100,
      fullCallInputTokens: 1_000 + payloadTokens,
      fixedOverheadInputTokens: 1_000,
      agentCarryPayload: {
        contentType: "text/markdown",
        text: `Exact target payload for ${runId}`,
        sha256: "d".repeat(64),
        utf8Bytes: 100,
        tokens: payloadTokens
      }
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
const inputs: ReviewInputArtifact[] = fixtures.flatMap((fixture) => modes.map((mode) => ({
  fixtureId: fixture.id,
  mode,
  contentType: "text/markdown",
  content: `Handoff input for ${fixture.id}:${mode}`
})));

function advisory(): AdvisoryVerdictSet {
  return {
    schemaVersion: "1.0.0",
    benchmarkId: "second-36",
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

function humanReviewExport(): HumanReviewExport {
  return {
    schemaVersion: "1.0.0",
    benchmarkId: "second-36",
    reviewerKind: "human",
    humanReviewer: "human-reviewer",
    humanConfirmed: true,
    exportedAt: "2026-07-21T02:00:00Z",
    complete: true,
    reviews: results.map((entry) => {
      const fixture = fixtures.find((candidate) => candidate.id === entry.fixtureId)!;
      const facts = [
        ...fixture.groundTruth.criticalConstraints,
        ...fixture.groundTruth.objectiveAndState,
        ...fixture.groundTruth.decisionsAndFailedAttempts,
        ...fixture.groundTruth.completedAndPending,
        ...fixture.groundTruth.workspaceEvidence,
        fixture.groundTruth.nextAction
      ];
      return {
        runId: entry.runId,
        outcome: "pass" as const,
        factVerdicts: Object.fromEntries(facts.map((fact) => [fact.id, "preserved"])),
        note: "Compared the exact input and output.",
        reviewedAt: "2026-07-21T01:59:00Z"
      };
    })
  };
}

describe("benchmark review materialization", () => {
  it("materializes all assessments, deterministic scores, and the aggregate report", () => {
    const materialized = finalizeBenchmarkReview(fixtures, results, advisory(), confirmation);

    expect(materialized.assessments).toHaveLength(36);
    expect(materialized.scores).toHaveLength(36);
    expect(materialized.resultSet.reports).toHaveLength(36);
    expect(materialized.report.benchmarkV2Passed).toBe(true);
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

  it("renders a self-contained Chinese side-by-side review workbench", () => {
    const html = renderReviewHtml(fixtures, inputs, results, advisory());

    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain("输入 · 交接内容");
    expect(html).toContain("输出 · Agent 回答");
    expect(html).toContain("通过 · 足以继续工作");
    expect(html).toContain("不通过 · 可能导致错误续接");
    expect(html).toContain("我是人工复核人，本次判断由我本人完成");
    expect(html).toContain("导出复核结果");
    expect(html).toContain("localStorage");
    expect(html).toContain("Handoff input for architecture-01-streaming-log:visible-transcript");

    const hostileInputs = inputs.map((input, index) => index === 0
      ? { ...input, content: "</script><script>alert('unsafe')</script>" }
      : input);
    const hostileHtml = renderReviewHtml(fixtures, hostileInputs, results, advisory());
    expect(hostileHtml).not.toContain("</script><script>alert('unsafe')</script>");
    expect(hostileHtml).toContain("\\u003c/script\\u003e");
  });

  it("materializes exported browser decisions instead of trusting advisory verdicts", () => {
    const humanReview = humanReviewExport();
    const first = humanReview.reviews[0]!;
    const firstFactId = Object.keys(first.factVerdicts)[0]!;
    const corrected: HumanReviewExport = {
      ...humanReview,
      reviews: humanReview.reviews.map((review, index) => index === 0
        ? {
            ...review,
            outcome: "fail",
            factVerdicts: { ...review.factVerdicts, [firstFactId]: "contradicted" },
            note: "The output reverses this constraint."
          }
        : review)
    };

    const materialized = finalizeBenchmarkReviewFromExport(
      fixtures,
      results,
      advisory(),
      corrected,
      "https://github.com/example/repo/issues/5#issuecomment-2"
    );

    const correctedAssessment = materialized.assessments.find(
      (assessment) => assessment.runId === first.runId
    );
    expect(correctedAssessment?.categories.criticalConstraints[0]).toMatchObject({
      factId: firstFactId,
      verdict: "contradicted"
    });
    expect(materialized.humanReview).toEqual(corrected);

    expect(() => finalizeBenchmarkReviewFromExport(
      fixtures,
      results,
      advisory(),
      { ...humanReview, complete: false } as unknown as HumanReviewExport,
      "https://github.com/example/repo/issues/5#issuecomment-3"
    )).toThrow("metadata is invalid or incomplete");

    expect(() => finalizeBenchmarkReviewFromExport(
      fixtures,
      results,
      advisory(),
      {
        ...humanReview,
        reviewerKind: "ai",
        humanConfirmed: false
      } as unknown as HumanReviewExport,
      "https://github.com/example/repo/issues/5#issuecomment-4"
    )).toThrow("explicit human attestation");
  });
});
