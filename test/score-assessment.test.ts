import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  renderScoreMarkdown,
  renderScoreJson,
  scoreAssessment,
  type ContinuationAssessment,
  type ScoreableFixture
} from "../src/benchmark/score-assessment.js";

function readJson<T>(relativePath: string): T {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("scoreAssessment", () => {
  const fixture = readJson<ScoreableFixture>(
    "../benchmark/fixtures/debugging-01-invoice-total.json"
  );
  const perfect = readJson<ContinuationAssessment>(
    "../benchmark/examples/assessment-perfect.json"
  );

  it("computes a perfect deterministic report", () => {
    const report = scoreAssessment(fixture, perfect);

    expect(report.fidelityScore).toBe(100);
    expect(report.tokens.ratio).toBe(0.4);
    expect(report.criticalConstraintMisses).toEqual([]);
    expect(report.gates).toEqual({
      criticalConstraints100Percent: true,
      correctNextAction: true,
      noRepeatedFailedPath: true,
      tokenRatioAtMost40Percent: true
    });
  });

  it("keeps critical misses and repeated failed paths outside the aggregate", () => {
    const assessment: ContinuationAssessment = {
      ...perfect,
      categories: {
        ...perfect.categories,
        criticalConstraints: perfect.categories.criticalConstraints.map((fact, index) =>
          index === 1 ? { ...fact, verdict: "partial" } : fact
        ),
        nextAction: perfect.categories.nextAction.map((fact) => ({
          ...fact,
          verdict: "contradicted"
        }))
      },
      repeatedFailedPaths: ["Retry the cache hypothesis."]
    };

    const report = scoreAssessment(fixture, assessment);

    expect(report.fidelityScore).toBe(87.5);
    expect(report.criticalConstraintMisses).toEqual([
      { factId: "d01-constraint-currency", verdict: "partial" }
    ]);
    expect(report.gates.criticalConstraints100Percent).toBe(false);
    expect(report.gates.correctNextAction).toBe(false);
    expect(report.gates.noRepeatedFailedPath).toBe(false);
  });

  it("rejects missing or unknown ground-truth fact ids", () => {
    const assessment: ContinuationAssessment = {
      ...perfect,
      categories: {
        ...perfect.categories,
        nextAction: perfect.categories.nextAction.map((fact) => ({
          ...fact,
          factId: "unknown-next"
        }))
      }
    };

    expect(() => scoreAssessment(fixture, assessment)).toThrow(
      "nextAction fact ids do not match ground truth"
    );
  });

  it("renders stable Markdown", () => {
    const markdown = renderScoreMarkdown(scoreAssessment(fixture, perfect));

    expect(markdown).toContain("- Fidelity: 100.00 / 100.00");
    expect(markdown).toContain("- Provider route: example-provider");
    expect(markdown).toContain("| criticalConstraints | 30.00 | 30.00 |");
    expect(markdown).toContain("- PASS token ratio at most 40%");
  });

  it("renders deterministic JSON regardless of settings key insertion order", () => {
    const left = scoreAssessment(fixture, {
      ...perfect,
      target: { ...perfect.target, settings: { temperature: 0, locale: "en" } }
    });
    const right = scoreAssessment(fixture, {
      ...perfect,
      target: { ...perfect.target, settings: { locale: "en", temperature: 0 } }
    });

    expect(renderScoreJson(left)).toBe(renderScoreJson(right));
  });
});
