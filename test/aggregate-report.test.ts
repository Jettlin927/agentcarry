import { describe, expect, it } from "vitest";
import {
  aggregateBenchmark,
  renderAggregateJson,
  renderAggregateMarkdown,
  type BenchmarkResultSet
} from "../src/benchmark/aggregate-report.js";
import type { ContinuationScoreReport } from "../src/benchmark/score-assessment.js";

const fixtureIds = Array.from({ length: 12 }, (_, index) => `fixture-${index + 1}`);

function score(
  fixtureId: string,
  mode: ContinuationScoreReport["mode"],
  fidelityScore: number,
  ratio: number
): ContinuationScoreReport {
  return {
    schemaVersion: "1.0.0",
    runId: `${fixtureId}:${mode}:initial`,
    fixtureId,
    mode,
    target: {
      agent: "claude",
      model: "fixed-model",
      provider: "test-provider",
      settings: { permissionMode: "plan", tools: false }
    },
    reviewer: "human-reviewer",
    reviewedAt: "2026-07-21T00:00:00Z",
    fidelityScore,
    categoryScores: [],
    criticalConstraintMisses: [],
    repeatedFailedPaths: [],
    unsupportedClaims: [],
    tokens: {
      input: mode === "visible-transcript" ? 1_000 : Math.round(1_000 * ratio),
      visibleTranscriptBaseline: 1_000,
      ratio
    },
    gates: {
      criticalConstraints100Percent: true,
      correctNextAction: true,
      noRepeatedFailedPath: true,
      tokenRatioAtMost40Percent: ratio <= 0.4
    }
  };
}

function resultSet(): BenchmarkResultSet {
  return {
    schemaVersion: "1.0.0",
    benchmarkId: "first-36",
    reports: fixtureIds.flatMap((fixtureId) => [
      score(fixtureId, "visible-transcript", 80, 1),
      score(fixtureId, "deterministic-capsule", 85, 0.4),
      score(fixtureId, "source-assisted-capsule", 90, 0.3)
    ]),
    reruns: []
  };
}

describe("aggregateBenchmark", () => {
  it("requires and summarizes an exact 12 by 3 initial result set", () => {
    const report = aggregateBenchmark(resultSet(), fixtureIds);

    expect(report.initialRuns).toBe(36);
    expect(report.modes).toEqual([
      expect.objectContaining({ mode: "visible-transcript", runs: 12, meanFidelity: 80 }),
      expect.objectContaining({ mode: "deterministic-capsule", runs: 12, meanFidelity: 85 }),
      expect.objectContaining({ mode: "source-assisted-capsule", runs: 12, meanFidelity: 90 })
    ]);
    expect(report.capsuleGates).toEqual([
      expect.objectContaining({ mode: "deterministic-capsule", meanFidelityDelta: 5, passed: true }),
      expect.objectContaining({ mode: "source-assisted-capsule", meanFidelityDelta: 10, passed: true })
    ]);
    expect(report.phase0Passed).toBe(true);
  });

  it("rejects missing pairs and mixed target settings", () => {
    const missing = resultSet();
    const original = resultSet();
    const mixed: BenchmarkResultSet = {
      ...original,
      reports: original.reports.map((report, index) => index === 5
        ? { ...report, target: { ...report.target, settings: { permissionMode: "default" } } }
        : report)
    };

    expect(() => aggregateBenchmark({ ...missing, reports: missing.reports.slice(1) }, fixtureIds)).toThrow(
      "exactly 36 initial reports"
    );
    expect(() => aggregateBenchmark(mixed, fixtureIds)).toThrow("target settings differ");
  });

  it("fails gates fixture by fixture and does not hide unsupported claims", () => {
    const originalSet = resultSet();
    const reportIndex = originalSet.reports.findIndex((report) =>
      report.fixtureId === "fixture-4" && report.mode === "deterministic-capsule"
    );
    const input: BenchmarkResultSet = {
      ...originalSet,
      reports: originalSet.reports.map((report, index) => index === reportIndex
        ? {
            ...report,
            fidelityScore: 79,
            unsupportedClaims: ["Claimed an unrun test passed."]
          }
        : report)
    };

    const report = aggregateBenchmark(input, fixtureIds);
    const deterministic = report.capsuleGates.find((gate) => gate.mode === "deterministic-capsule")!;

    expect(deterministic.fidelityNoWorseThanBaseline).toBe(false);
    expect(deterministic.meanFidelityDelta).toBe(4.5);
    expect(deterministic.unsupportedClaimsNoWorseThanBaseline).toBe(false);
    expect(deterministic.unsupportedClaimDelta).toBe(1);
    expect(deterministic.passed).toBe(false);
    expect(report.modes.find((mode) => mode.mode === "deterministic-capsule")).toMatchObject({
      unsupportedClaimRuns: 1,
      unsupportedClaims: 1
    });
  });

  it("discloses reruns without counting them as replacements", () => {
    const original = resultSet();
    const input: BenchmarkResultSet = {
      ...original,
      reruns: [{
        originalRunId: original.reports[0]!.runId,
        rerunRunId: "fixture-1:visible-transcript:rerun-1",
        reason: "Human reviewers disputed one qualifier.",
        resolution: "Initial verdict retained after a second review.",
        includedInAggregate: false
      }]
    };
    const report = aggregateBenchmark(input, fixtureIds);

    expect(report.initialRuns).toBe(36);
    expect(report.reruns).toHaveLength(1);
    expect(renderAggregateMarkdown(report)).toContain("Initial verdict retained");
  });

  it("renders deterministic JSON and explicit PASS or FAIL Markdown", () => {
    const report = aggregateBenchmark(resultSet(), fixtureIds);
    const original = resultSet();
    const reversedSettings: BenchmarkResultSet = {
      ...original,
      reports: original.reports.map((entry) => ({
        ...entry,
        target: { ...entry.target, settings: { tools: false, permissionMode: "plan" } }
      }))
    };

    expect(renderAggregateJson(aggregateBenchmark(reversedSettings, fixtureIds))).toBe(
      renderAggregateJson(report)
    );
    expect(renderAggregateMarkdown(report)).toContain("Phase 0: **PASS**");
    expect(renderAggregateMarkdown(report)).toContain("Provider route: test-provider");
    expect(renderAggregateMarkdown(report)).toContain("Each comparison must pass fixture by fixture");
  });

  it("requires an identifiable human review for every initial run", () => {
    const original = resultSet();
    const reports = original.reports.map((report, index) => index === 0
      ? { ...report, reviewer: "" }
      : report);

    expect(() => aggregateBenchmark({ ...original, reports }, fixtureIds)).toThrow(
      "requires an identifiable human review"
    );
  });
});
