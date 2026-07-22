import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
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
    expect(report.tokens).toMatchObject({
      fullCallInput: 1400,
      fixedOverhead: 1000,
      agentCarryPayload: 400,
      visibleTranscriptPayloadBaseline: 1000,
      visibleTranscriptPayloadRatio: 0.4,
      canonicalWorkCapsulePayloadBaseline: 1000,
      canonicalCompressionRatio: 0.4
    });
    expect(report.criticalConstraintMisses).toEqual([]);
    expect(report.gates).toEqual({
      criticalConstraints100Percent: true,
      correctNextAction: true,
      noRepeatedFailedPath: true,
      canonicalCompressionAtMost40Percent: true
    });
  });

  it("passes exactly 40% and fails the next measurable payload token", () => {
    const boundary = scoreAssessment(fixture, perfect);
    const above = scoreAssessment(fixture, {
      ...perfect,
      tokens: {
        ...perfect.tokens,
        fullCallInput: 1401,
        agentCarryPayload: 401
      }
    });

    expect(boundary.gates.canonicalCompressionAtMost40Percent).toBe(true);
    expect(above.tokens.canonicalCompressionRatio).toBe(0.401);
    expect(above.gates.canonicalCompressionAtMost40Percent).toBe(false);

    const roundedDown = scoreAssessment(fixture, {
      ...perfect,
      tokens: {
        ...perfect.tokens,
        fullCallInput: 101_000 + 40_001,
        fixedOverhead: 101_000,
        agentCarryPayload: 40_001,
        visibleTranscriptPayloadBaseline: 100_000,
        canonicalWorkCapsulePayloadBaseline: 100_000
      }
    });
    expect(roundedDown.tokens.canonicalCompressionRatio).toBe(0.4);
    expect(roundedDown.gates.canonicalCompressionAtMost40Percent).toBe(false);
  });

  it("reports visible compression only as an advisory comparison", () => {
    const report = scoreAssessment(fixture, {
      ...perfect,
      tokens: {
        ...perfect.tokens,
        visibleTranscriptPayloadBaseline: 100
      }
    });

    expect(report.tokens.visibleTranscriptPayloadRatio).toBe(4);
    expect(report.tokens.canonicalCompressionRatio).toBe(0.4);
    expect(report.gates.canonicalCompressionAtMost40Percent).toBe(true);
  });

  it("rejects missing or internally inconsistent calibration metering", () => {
    expect(() => scoreAssessment(fixture, {
      ...perfect,
      tokens: {
        ...perfect.tokens,
        fixedOverhead: 999
      }
    })).toThrow("payload tokens must equal full-call input minus fixed overhead");

    expect(() => scoreAssessment(fixture, {
      ...perfect,
      tokens: {
        ...perfect.tokens,
        method: undefined
      }
    } as unknown as ContinuationAssessment)).toThrow("requires target-calibration-delta-v1");
  });

  it("requires every Benchmark v2 token field in the assessment schema", () => {
    const schema = readJson<object>(
      "../benchmark/schema/continuation-assessment.v2.schema.json"
    );
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat("date-time", {
      type: "string",
      validate: (value: string) => !Number.isNaN(Date.parse(value))
    });
    const validate = ajv.compile(schema);
    expect(validate(perfect), JSON.stringify(validate.errors)).toBe(true);

    const missingFixedOverhead = {
      ...perfect,
      tokens: { ...perfect.tokens }
    } as Record<string, unknown> & { tokens: Record<string, unknown> };
    delete missingFixedOverhead.tokens.fixedOverhead;
    expect(validate(missingFixedOverhead)).toBe(false);
    expect(validate.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ instancePath: "/tokens", keyword: "required" })
    ]));

    const visible = {
      ...perfect,
      mode: "visible-transcript",
      tokens: {
        ...perfect.tokens,
        fullCallInput: 2_000,
        agentCarryPayload: 1_000,
        canonicalWorkCapsulePayloadBaseline: null
      }
    };
    expect(validate(visible), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({
      ...visible,
      tokens: { ...visible.tokens, canonicalWorkCapsulePayloadBaseline: 1_000 }
    })).toBe(false);
  });

  it("keeps the published Phase 0 v1 report and raw token fields frozen", () => {
    const report = readJson<{
      schemaVersion: string;
      modes: Array<{ meanTokenRatio: number }>;
    }>("../benchmark/runs/2026-07-21-cc-switch-gpt-5.6-sol/final/report.json");
    const result = readJson<{
      schemaVersion: string;
      input: { exactTargetInputTokens: number };
    }>("../benchmark/runs/2026-07-21-cc-switch-gpt-5.6-sol/results/debugging-01-invoice-total--visible-transcript.json");

    expect(report.schemaVersion).toBe("1.0.0");
    expect(report.modes[0]?.meanTokenRatio).toBeTypeOf("number");
    expect(result).toMatchObject({
      schemaVersion: "1.0.0",
      input: { exactTargetInputTokens: 1431 }
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
    expect(markdown).toContain("- Fixed target overhead tokens: 1000");
    expect(markdown).toContain("- PASS canonical Work Capsule compression at most 40%");
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
