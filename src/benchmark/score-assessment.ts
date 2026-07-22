export const categoryWeights = {
  criticalConstraints: 30,
  objectiveAndState: 20,
  decisionsAndFailedAttempts: 20,
  completedAndPending: 15,
  workspaceEvidence: 10,
  nextAction: 5
} as const;

export type CategoryName = keyof typeof categoryWeights;
export type FactVerdict = "preserved" | "partial" | "missing" | "contradicted";

export interface FactAssessment {
  readonly factId: string;
  readonly verdict: FactVerdict;
  readonly note: string;
}

export interface ContinuationAssessment {
  readonly schemaVersion: "2.0.0";
  readonly runId: string;
  readonly fixtureId: string;
  readonly mode: "visible-transcript" | "deterministic-capsule" | "source-assisted-capsule";
  readonly target: {
    readonly agent: string;
    readonly model: string;
    readonly provider: string;
    readonly settings: Readonly<Record<string, unknown>>;
  };
  readonly tokens: {
    readonly method: "target-calibration-delta-v1";
    readonly fullCallInput: number;
    readonly fixedOverhead: number;
    readonly agentCarryPayload: number;
    readonly visibleTranscriptPayloadBaseline: number;
    readonly canonicalWorkCapsulePayloadBaseline: number | null;
  };
  readonly review: {
    readonly humanReviewer: string;
    readonly reviewedAt: string;
    readonly llmJudge?: { readonly model: string; readonly advisoryOnly: true };
  };
  readonly categories: Readonly<Record<CategoryName, readonly FactAssessment[]>>;
  readonly repeatedFailedPaths: readonly string[];
  readonly unsupportedClaims: readonly string[];
}

export interface ScoreableFixture {
  readonly id: string;
  readonly groundTruth: {
    readonly criticalConstraints: ReadonlyArray<{ readonly id: string }>;
    readonly objectiveAndState: ReadonlyArray<{ readonly id: string }>;
    readonly decisionsAndFailedAttempts: ReadonlyArray<{ readonly id: string }>;
    readonly completedAndPending: ReadonlyArray<{ readonly id: string }>;
    readonly workspaceEvidence: ReadonlyArray<{ readonly id: string }>;
    readonly nextAction: { readonly id: string };
  };
}

export interface CategoryScore {
  readonly category: CategoryName;
  readonly weight: number;
  readonly earned: number;
  readonly facts: ReadonlyArray<{
    readonly factId: string;
    readonly verdict: FactVerdict;
    readonly points: number;
  }>;
}

export interface ContinuationScoreReport {
  readonly schemaVersion: "2.0.0";
  readonly runId: string;
  readonly fixtureId: string;
  readonly mode: ContinuationAssessment["mode"];
  readonly target: ContinuationAssessment["target"];
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly fidelityScore: number;
  readonly categoryScores: readonly CategoryScore[];
  readonly criticalConstraintMisses: ReadonlyArray<{
    readonly factId: string;
    readonly verdict: Exclude<FactVerdict, "preserved">;
  }>;
  readonly repeatedFailedPaths: readonly string[];
  readonly unsupportedClaims: readonly string[];
  readonly tokens: {
    readonly method: "target-calibration-delta-v1";
    readonly fullCallInput: number;
    readonly fixedOverhead: number;
    readonly agentCarryPayload: number;
    readonly visibleTranscriptPayloadBaseline: number;
    readonly visibleTranscriptPayloadRatio: number;
    readonly canonicalWorkCapsulePayloadBaseline: number | null;
    readonly canonicalCompressionRatio: number | null;
  };
  readonly gates: {
    readonly criticalConstraints100Percent: boolean;
    readonly correctNextAction: boolean;
    readonly noRepeatedFailedPath: boolean;
    readonly canonicalCompressionAtMost40Percent: boolean | null;
  };
}

const categoryOrder = Object.keys(categoryWeights) as CategoryName[];
const verdictPoints: Readonly<Record<FactVerdict, number>> = {
  preserved: 1,
  partial: 0.5,
  missing: 0,
  contradicted: 0
};

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function expectedFactIds(fixture: ScoreableFixture, category: CategoryName): string[] {
  if (category === "nextAction") {
    return [fixture.groundTruth.nextAction.id];
  }
  return fixture.groundTruth[category].map((fact) => fact.id);
}

function assertCompleteAssessment(
  fixture: ScoreableFixture,
  assessment: ContinuationAssessment,
  category: CategoryName
): void {
  const expected = [...expectedFactIds(fixture, category)].sort();
  const actual = assessment.categories[category].map((fact) => fact.factId).sort();
  if (new Set(actual).size !== actual.length) {
    throw new Error(`${category} contains duplicate fact assessments`);
  }
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new Error(
      `${category} fact ids do not match ground truth; expected ${expected.join(", ")}, received ${actual.join(", ")}`
    );
  }
}

export function scoreAssessment(
  fixture: ScoreableFixture,
  assessment: ContinuationAssessment
): ContinuationScoreReport {
  if (fixture.id !== assessment.fixtureId) {
    throw new Error(`fixture id ${fixture.id} does not match assessment ${assessment.fixtureId}`);
  }
  if (assessment.schemaVersion !== "2.0.0" || assessment.tokens.method !== "target-calibration-delta-v1") {
    throw new Error("Benchmark v2 assessment requires target-calibration-delta-v1 metering");
  }
  const tokenValues = [
    assessment.tokens.fullCallInput,
    assessment.tokens.fixedOverhead,
    assessment.tokens.agentCarryPayload,
    assessment.tokens.visibleTranscriptPayloadBaseline,
    assessment.tokens.canonicalWorkCapsulePayloadBaseline
  ];
  if (tokenValues.some((value) => value !== null && (!Number.isInteger(value) || value < 0))) {
    throw new Error("Benchmark v2 token measurements must be non-negative integers");
  }
  if (assessment.tokens.visibleTranscriptPayloadBaseline < 1) {
    throw new Error("visible transcript payload baseline tokens must be at least 1");
  }
  if (
    assessment.tokens.fullCallInput - assessment.tokens.fixedOverhead
    !== assessment.tokens.agentCarryPayload
  ) {
    throw new Error("AgentCarry payload tokens must equal full-call input minus fixed overhead");
  }
  if (
    assessment.mode === "visible-transcript"
    && assessment.tokens.agentCarryPayload
      !== assessment.tokens.visibleTranscriptPayloadBaseline
  ) {
    throw new Error("visible transcript payload must equal its payload baseline");
  }
  if (
    assessment.mode === "visible-transcript"
      ? assessment.tokens.canonicalWorkCapsulePayloadBaseline !== null
      : assessment.tokens.canonicalWorkCapsulePayloadBaseline === null
        || assessment.tokens.canonicalWorkCapsulePayloadBaseline < 1
  ) {
    throw new Error("canonical Work Capsule baseline must be null for visible mode and positive for capsule modes");
  }

  for (const category of categoryOrder) {
    assertCompleteAssessment(fixture, assessment, category);
  }

  const categoryScores = categoryOrder.map((category): CategoryScore => {
    const facts = [...assessment.categories[category]]
      .sort((left, right) => left.factId.localeCompare(right.factId))
      .map((fact) => ({
        factId: fact.factId,
        verdict: fact.verdict,
        points: verdictPoints[fact.verdict]
      }));
    const earned = round(
      (facts.reduce((sum, fact) => sum + fact.points, 0) / facts.length) * categoryWeights[category],
      2
    );
    return { category, weight: categoryWeights[category], earned, facts };
  });

  const criticalConstraintMisses = assessment.categories.criticalConstraints
    .filter((fact): fact is FactAssessment & { verdict: Exclude<FactVerdict, "preserved"> } =>
      fact.verdict !== "preserved"
    )
    .map((fact) => ({ factId: fact.factId, verdict: fact.verdict }))
    .sort((left, right) => left.factId.localeCompare(right.factId));
  const nextActionCorrect = assessment.categories.nextAction.every(
    (fact) => fact.verdict === "preserved"
  );
  const visibleTranscriptPayloadRatio = round(
    assessment.tokens.agentCarryPayload
      / assessment.tokens.visibleTranscriptPayloadBaseline,
    4
  );
  const canonicalBaseline = assessment.tokens.canonicalWorkCapsulePayloadBaseline;
  const canonicalCompressionRatio = canonicalBaseline === null
    ? null
    : round(assessment.tokens.agentCarryPayload / canonicalBaseline, 4);
  const canonicalCompressionAtMost40Percent = canonicalBaseline === null
    ? null
    : assessment.tokens.agentCarryPayload * 100 <= canonicalBaseline * 40;

  return {
    schemaVersion: "2.0.0",
    runId: assessment.runId,
    fixtureId: assessment.fixtureId,
    mode: assessment.mode,
    target: assessment.target,
    reviewer: assessment.review.humanReviewer,
    reviewedAt: assessment.review.reviewedAt,
    fidelityScore: round(
      categoryScores.reduce((sum, category) => sum + category.earned, 0),
      2
    ),
    categoryScores,
    criticalConstraintMisses,
    repeatedFailedPaths: [...assessment.repeatedFailedPaths].sort(),
    unsupportedClaims: [...assessment.unsupportedClaims].sort(),
    tokens: {
      method: assessment.tokens.method,
      fullCallInput: assessment.tokens.fullCallInput,
      fixedOverhead: assessment.tokens.fixedOverhead,
      agentCarryPayload: assessment.tokens.agentCarryPayload,
      visibleTranscriptPayloadBaseline: assessment.tokens.visibleTranscriptPayloadBaseline,
      visibleTranscriptPayloadRatio,
      canonicalWorkCapsulePayloadBaseline: canonicalBaseline,
      canonicalCompressionRatio
    },
    gates: {
      criticalConstraints100Percent: criticalConstraintMisses.length === 0,
      correctNextAction: nextActionCorrect,
      noRepeatedFailedPath: assessment.repeatedFailedPaths.length === 0,
      canonicalCompressionAtMost40Percent
    }
  };
}

function mark(value: boolean | null): string {
  return value === null ? "N/A" : value ? "PASS" : "FAIL";
}

export function renderScoreMarkdown(report: ContinuationScoreReport): string {
  const rows = report.categoryScores
    .map((score) => `| ${score.category} | ${score.earned.toFixed(2)} | ${score.weight.toFixed(2)} |`)
    .join("\n");
  const criticalMisses = report.criticalConstraintMisses.length === 0
    ? "None"
    : report.criticalConstraintMisses
      .map((miss) => `${miss.factId} (${miss.verdict})`)
      .join(", ");
  const repeated = report.repeatedFailedPaths.length === 0
    ? "None"
    : report.repeatedFailedPaths.join("; ");
  const unsupported = report.unsupportedClaims.length === 0
    ? "None"
    : report.unsupportedClaims.join("; ");

  return `# Continuation score: ${report.runId}

- Fixture: ${report.fixtureId}
- Mode: ${report.mode}
- Target: ${report.target.agent} / ${report.target.model}
- Provider route: ${report.target.provider}
- Human reviewer: ${report.reviewer}
- Fidelity: ${report.fidelityScore.toFixed(2)} / 100.00
- Full-call input tokens: ${report.tokens.fullCallInput}
- Fixed target overhead tokens: ${report.tokens.fixedOverhead}
- AgentCarry payload tokens: ${report.tokens.agentCarryPayload}
- Visible-transcript payload baseline: ${report.tokens.visibleTranscriptPayloadBaseline}
- Visible-transcript payload ratio: ${report.tokens.visibleTranscriptPayloadRatio.toFixed(4)}
- Canonical Work Capsule payload baseline: ${report.tokens.canonicalWorkCapsulePayloadBaseline ?? "N/A"}
- Canonical compression ratio: ${report.tokens.canonicalCompressionRatio?.toFixed(4) ?? "N/A"}

| Category | Earned | Weight |
| --- | ---: | ---: |
${rows}

## Gates

- ${mark(report.gates.criticalConstraints100Percent)} critical constraints 100%
- ${mark(report.gates.correctNextAction)} correct next action
- ${mark(report.gates.noRepeatedFailedPath)} no repeated failed path
- ${mark(report.gates.canonicalCompressionAtMost40Percent)} canonical Work Capsule compression at most 40%

## Separate findings

- Critical misses: ${criticalMisses}
- Repeated failed paths: ${repeated}
- Unsupported claims: ${unsupported}
`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

export function renderScoreJson(report: ContinuationScoreReport): string {
  return `${JSON.stringify(canonicalize(report), null, 2)}\n`;
}
