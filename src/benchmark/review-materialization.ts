import {
  aggregateBenchmark,
  type AggregateBenchmarkReport,
  type BenchmarkResultSet
} from "./aggregate-report.js";
import { canonicalJson, type HandoffMode } from "./build-handoff-input.js";
import type {
  CanonicalCapsuleMeasurement,
  TargetRunResult
} from "./run-target-continuation.js";
import {
  categoryWeights,
  scoreAssessment,
  type CategoryName,
  type ContinuationAssessment,
  type ContinuationScoreReport,
  type FactAssessment,
  type FactVerdict
} from "./score-assessment.js";

const modes: readonly HandoffMode[] = [
  "visible-transcript",
  "deterministic-capsule",
  "source-assisted-capsule"
];
const categories = Object.keys(categoryWeights) as CategoryName[];

export interface ReviewFact {
  readonly id: string;
  readonly text: string;
}

export interface ReviewFixture {
  readonly id: string;
  readonly groundTruth: {
    readonly criticalConstraints: readonly ReviewFact[];
    readonly objectiveAndState: readonly ReviewFact[];
    readonly decisionsAndFailedAttempts: readonly ReviewFact[];
    readonly completedAndPending: readonly ReviewFact[];
    readonly workspaceEvidence: readonly ReviewFact[];
    readonly nextAction: ReviewFact;
  };
}

export interface AdvisoryVerdict {
  readonly verdict: FactVerdict;
  readonly note: string;
}

export interface AdvisoryRunVerdicts {
  readonly runId: string;
  readonly exceptions: Readonly<Record<string, AdvisoryVerdict>>;
  readonly repeatedFailedPaths?: readonly string[];
  readonly unsupportedClaims?: readonly string[];
}

export interface AdvisoryVerdictSet {
  readonly schemaVersion: "1.0.0";
  readonly benchmarkId: string;
  readonly status: "advisory-only-pending-human-review";
  readonly reviewer: {
    readonly kind: "llm";
    readonly name: string;
    readonly advisoryOnly: true;
    readonly reviewedAt: string;
  };
  readonly defaultVerdict: "preserved";
  readonly defaultRepeatedFailedPaths: readonly string[];
  readonly defaultUnsupportedClaims: readonly string[];
  readonly instructions: string;
  readonly runs: readonly AdvisoryRunVerdicts[];
}

export interface HumanReviewConfirmationInput {
  readonly confirmed: true;
  readonly humanReviewer: string;
  readonly reviewedAt: string;
  readonly confirmationSource: string;
}

export interface HumanReviewConfirmation {
  readonly schemaVersion: "1.0.0";
  readonly benchmarkId: string;
  readonly confirmed: true;
  readonly humanReviewer: string;
  readonly reviewedAt: string;
  readonly confirmationSource: string;
  readonly advisoryReviewer: string;
  readonly advisoryReviewedAt: string;
}

export interface HumanRunReview {
  readonly runId: string;
  readonly outcome: "pass" | "fail";
  readonly factVerdicts: Readonly<Record<string, FactVerdict>>;
  readonly repeatedFailedPaths: readonly string[];
  readonly unsupportedClaims: readonly string[];
  readonly note: string;
  readonly reviewedAt: string;
}

export interface HumanReviewExport {
  readonly schemaVersion: "2.0.0";
  readonly benchmarkId: string;
  readonly reviewerKind: "human";
  readonly humanReviewer: string;
  readonly humanConfirmed: true;
  readonly exportedAt: string;
  readonly complete: true;
  readonly reviews: readonly HumanRunReview[];
}

export interface MaterializedBenchmarkReview {
  readonly assessments: readonly ContinuationAssessment[];
  readonly scores: readonly ContinuationScoreReport[];
  readonly resultSet: BenchmarkResultSet;
  readonly report: AggregateBenchmarkReport;
  readonly confirmation: HumanReviewConfirmation;
  readonly humanReview?: HumanReviewExport;
}

interface ValidatedReviewInputs {
  readonly fixtures: readonly ReviewFixture[];
  readonly resultsByRunId: ReadonlyMap<string, TargetRunResult>;
  readonly advisoryByRunId: ReadonlyMap<string, AdvisoryRunVerdicts>;
}

export interface PreparedReviewRun {
  readonly fixture: ReviewFixture;
  readonly result: TargetRunResult;
  readonly advisory: AdvisoryRunVerdicts;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function factsForCategory(
  fixture: ReviewFixture,
  category: CategoryName
): readonly ReviewFact[] {
  return category === "nextAction"
    ? [fixture.groundTruth.nextAction]
    : fixture.groundTruth[category];
}

function allFacts(fixture: ReviewFixture): readonly ReviewFact[] {
  return categories.flatMap((category) => factsForCategory(fixture, category));
}

function validateReviewInputs(
  fixtures: readonly ReviewFixture[],
  results: readonly TargetRunResult[],
  advisory: AdvisoryVerdictSet
): ValidatedReviewInputs {
  if (
    advisory.schemaVersion !== "1.0.0"
    || advisory.benchmarkId.trim().length === 0
    || advisory.status !== "advisory-only-pending-human-review"
    || advisory.defaultVerdict !== "preserved"
    || advisory.reviewer.kind !== "llm"
    || advisory.reviewer.advisoryOnly !== true
    || advisory.reviewer.name.trim().length === 0
    || Number.isNaN(Date.parse(advisory.reviewer.reviewedAt))
  ) {
    throw new Error("advisory verdict set metadata is invalid");
  }
  const sortedFixtures = [...fixtures].sort((left, right) => compareText(left.id, right.id));
  if (sortedFixtures.length !== 12 || new Set(sortedFixtures.map((fixture) => fixture.id)).size !== 12) {
    throw new Error("benchmark review requires exactly 12 unique fixtures");
  }
  const expectedRunIds = new Set(sortedFixtures.flatMap((fixture) => modes.map(
    (mode) => `${fixture.id}:${mode}:initial`
  )));
  const resultsByRunId = new Map<string, TargetRunResult>();
  for (const result of results) {
    if (!expectedRunIds.has(result.runId) || resultsByRunId.has(result.runId)) {
      throw new Error(`unexpected or duplicate target result ${result.runId}`);
    }
    resultsByRunId.set(result.runId, result);
  }
  if (resultsByRunId.size !== expectedRunIds.size) {
    throw new Error(`benchmark review requires ${expectedRunIds.size} target results`);
  }

  const fixtureById = new Map(sortedFixtures.map((fixture) => [fixture.id, fixture]));
  const advisoryByRunId = new Map<string, AdvisoryRunVerdicts>();
  for (const run of advisory.runs) {
    if (!expectedRunIds.has(run.runId) || advisoryByRunId.has(run.runId)) {
      throw new Error(`unexpected or duplicate advisory run ${run.runId}`);
    }
    const result = resultsByRunId.get(run.runId)!;
    const fixture = fixtureById.get(result.fixtureId)!;
    const knownFactIds = new Set(allFacts(fixture).map((fact) => fact.id));
    for (const [factId, verdict] of Object.entries(run.exceptions)) {
      if (!knownFactIds.has(factId)) {
        throw new Error(`run ${run.runId} contains unknown fact id ${factId}`);
      }
      if (verdict.note.trim().length === 0) {
        throw new Error(`run ${run.runId} fact ${factId} requires an advisory note`);
      }
    }
    advisoryByRunId.set(run.runId, run);
  }
  if (advisoryByRunId.size !== expectedRunIds.size) {
    throw new Error(`benchmark review requires ${expectedRunIds.size} advisory runs`);
  }
  return { fixtures: sortedFixtures, resultsByRunId, advisoryByRunId };
}

export function prepareReviewRuns(
  fixtures: readonly ReviewFixture[],
  results: readonly TargetRunResult[],
  advisory: AdvisoryVerdictSet
): readonly PreparedReviewRun[] {
  const validated = validateReviewInputs(fixtures, results, advisory);
  return validated.fixtures.flatMap((fixture) => modes.map((mode) => {
    const runId = `${fixture.id}:${mode}:initial`;
    return {
      fixture,
      result: validated.resultsByRunId.get(runId)!,
      advisory: validated.advisoryByRunId.get(runId)!
    };
  }));
}

function factAssessments(
  facts: readonly ReviewFact[],
  run: AdvisoryRunVerdicts
): FactAssessment[] {
  return facts.map((fact) => {
    const exception = run.exceptions[fact.id];
    return exception === undefined
      ? {
          factId: fact.id,
          verdict: "preserved",
          note: `Human reviewer confirmed the target output preserves: ${fact.text}`
        }
      : { factId: fact.id, verdict: exception.verdict, note: exception.note };
  });
}

function assessmentFor(
  fixture: ReviewFixture,
  result: TargetRunResult,
  run: AdvisoryRunVerdicts,
  visibleTranscriptPayloadBaseline: number,
  canonicalWorkCapsulePayloadBaseline: number | null,
  advisory: AdvisoryVerdictSet,
  confirmation: HumanReviewConfirmationInput,
  humanOutcome: HumanRunReview["outcome"],
  humanNote: string
): ContinuationAssessment {
  return {
    schemaVersion: "2.0.0",
    runId: result.runId,
    fixtureId: result.fixtureId,
    mode: result.mode,
    target: {
      agent: result.target.agent,
      model: result.target.model,
      provider: result.target.provider,
      settings: { ...result.target.settings }
    },
    tokens: {
      method: "target-calibration-delta-v1",
      fullCallInput: result.input.fullCallInputTokens,
      fixedOverhead: result.input.fixedOverheadInputTokens,
      agentCarryPayload: result.input.agentCarryPayload.tokens,
      visibleTranscriptPayloadBaseline,
      canonicalWorkCapsulePayloadBaseline
    },
    review: {
      humanReviewer: confirmation.humanReviewer,
      reviewedAt: confirmation.reviewedAt,
      outcome: humanOutcome,
      note: humanNote,
      llmJudge: { model: advisory.reviewer.name, advisoryOnly: true }
    },
    categories: {
      criticalConstraints: factAssessments(fixture.groundTruth.criticalConstraints, run),
      objectiveAndState: factAssessments(fixture.groundTruth.objectiveAndState, run),
      decisionsAndFailedAttempts: factAssessments(
        fixture.groundTruth.decisionsAndFailedAttempts,
        run
      ),
      completedAndPending: factAssessments(fixture.groundTruth.completedAndPending, run),
      workspaceEvidence: factAssessments(fixture.groundTruth.workspaceEvidence, run),
      nextAction: factAssessments([fixture.groundTruth.nextAction], run)
    },
    repeatedFailedPaths: [...(run.repeatedFailedPaths ?? advisory.defaultRepeatedFailedPaths)],
    unsupportedClaims: [...(run.unsupportedClaims ?? advisory.defaultUnsupportedClaims)]
  };
}

function canonicalBaselineTokens(
  resultsByRunId: ReadonlyMap<string, TargetRunResult>,
  measurements: readonly CanonicalCapsuleMeasurement[]
): ReadonlyMap<string, number> {
  const baselines = new Map<string, number>();
  for (const measurement of measurements) {
    const runId = `${measurement.fixtureId}:${measurement.mode}:initial`;
    const result = resultsByRunId.get(runId);
    const tokens = measurement.input?.canonicalWorkCapsulePayload?.tokens;
    if (
      result === undefined
      || result.mode === "visible-transcript"
      || baselines.has(runId)
      || measurement.schemaVersion !== "2.0.0"
      || measurement.purpose !== "canonical-work-capsule-baseline"
      || measurement.sourceFingerprint !== result.sourceFingerprint
      || canonicalJson(measurement.target) !== canonicalJson(result.target)
      || !Number.isInteger(tokens)
      || tokens < 1
      || measurement.input.fixedOverheadInputTokens !== result.input.fixedOverheadInputTokens
      || measurement.input.fullCallInputTokens
        - measurement.input.fixedOverheadInputTokens !== tokens
    ) {
      throw new Error(`invalid or duplicate canonical Work Capsule baseline ${runId}`);
    }
    baselines.set(runId, tokens);
  }
  const expected = [...resultsByRunId.values()].filter(
    (result) => result.mode !== "visible-transcript"
  );
  if (baselines.size !== expected.length) {
    throw new Error(`benchmark review requires ${expected.length} canonical Work Capsule baselines`);
  }
  for (const result of expected) {
    if (!baselines.has(result.runId)) {
      throw new Error(`missing canonical Work Capsule baseline ${result.runId}`);
    }
  }
  return baselines;
}

function validateConfirmation(confirmation: HumanReviewConfirmationInput): void {
  if (
    confirmation.confirmed !== true
    || confirmation.humanReviewer.trim().length === 0
    || Number.isNaN(Date.parse(confirmation.reviewedAt))
    || confirmation.confirmationSource.trim().length === 0
  ) {
    throw new Error("finalization requires an explicit human reviewer, timestamp, and confirmation source");
  }
}

export function finalizeBenchmarkReview(
  fixtures: readonly ReviewFixture[],
  results: readonly TargetRunResult[],
  canonicalMeasurements: readonly CanonicalCapsuleMeasurement[],
  advisory: AdvisoryVerdictSet,
  confirmation: HumanReviewConfirmationInput,
  humanReviews: ReadonlyMap<string, HumanRunReview> | undefined = undefined
): MaterializedBenchmarkReview {
  validateConfirmation(confirmation);
  const validated = validateReviewInputs(fixtures, results, advisory);
  const canonicalBaselines = canonicalBaselineTokens(
    validated.resultsByRunId,
    canonicalMeasurements
  );
  const fixtureById = new Map(validated.fixtures.map((fixture) => [fixture.id, fixture]));
  const visiblePayloadBaselines = new Map(validated.fixtures.map((fixture) => {
    const runId = `${fixture.id}:visible-transcript:initial`;
    return [fixture.id, validated.resultsByRunId.get(runId)!.input.agentCarryPayload.tokens];
  }));
  const assessments = [...validated.resultsByRunId.values()]
    .sort((left, right) => compareText(left.runId, right.runId))
    .map((result) => {
      const humanReview = humanReviews?.get(result.runId);
      return assessmentFor(
        fixtureById.get(result.fixtureId)!,
        result,
        validated.advisoryByRunId.get(result.runId)!,
        visiblePayloadBaselines.get(result.fixtureId)!,
        result.mode === "visible-transcript" ? null : canonicalBaselines.get(result.runId)!,
        advisory,
        confirmation,
        humanReview?.outcome ?? "pass",
        humanReview?.note ?? "Human reviewer confirmed the advisory verdicts."
      );
    });
  const scores = assessments.map((assessment) => scoreAssessment(
    fixtureById.get(assessment.fixtureId)!,
    assessment
  ));
  const resultSet: BenchmarkResultSet = {
    schemaVersion: "2.0.0",
    benchmarkId: advisory.benchmarkId,
    reports: scores,
    reruns: []
  };
  return {
    assessments,
    scores,
    resultSet,
    report: aggregateBenchmark(resultSet, validated.fixtures.map((fixture) => fixture.id)),
    confirmation: {
      schemaVersion: "1.0.0",
      benchmarkId: advisory.benchmarkId,
      confirmed: true,
      humanReviewer: confirmation.humanReviewer,
      reviewedAt: confirmation.reviewedAt,
      confirmationSource: confirmation.confirmationSource,
      advisoryReviewer: advisory.reviewer.name,
      advisoryReviewedAt: advisory.reviewer.reviewedAt
    }
  };
}

function validFindingList(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string" && item.trim().length > 0)
    && new Set(value).size === value.length;
}

function humanAdjustedReview(
  fixtures: readonly ReviewFixture[],
  results: readonly TargetRunResult[],
  advisory: AdvisoryVerdictSet,
  humanReview: HumanReviewExport
): {
  readonly advisory: AdvisoryVerdictSet;
  readonly reviews: ReadonlyMap<string, HumanRunReview>;
} {
  const validated = validateReviewInputs(fixtures, results, advisory);
  if (humanReview.reviewerKind !== "human" || humanReview.humanConfirmed !== true) {
    throw new Error("finalization requires explicit human attestation");
  }
  if (
    humanReview.schemaVersion !== "2.0.0"
    || humanReview.benchmarkId !== advisory.benchmarkId
    || humanReview.complete !== true
    || humanReview.humanReviewer.trim().length === 0
    || Number.isNaN(Date.parse(humanReview.exportedAt))
  ) {
    throw new Error("human review export metadata is invalid or incomplete");
  }
  const reviews = new Map<string, HumanRunReview>();
  for (const review of humanReview.reviews) {
    const result = validated.resultsByRunId.get(review.runId);
    if (
      result === undefined
      || reviews.has(review.runId)
      || (review.outcome !== "pass" && review.outcome !== "fail")
      || Number.isNaN(Date.parse(review.reviewedAt))
      || typeof review.note !== "string"
      || !validFindingList(review.repeatedFailedPaths)
      || !validFindingList(review.unsupportedClaims)
    ) {
      throw new Error(`invalid or duplicate human review ${review.runId}`);
    }
    const fixture = validated.fixtures.find((candidate) => candidate.id === result.fixtureId)!;
    const factIds = allFacts(fixture).map((fact) => fact.id);
    const submittedIds = Object.keys(review.factVerdicts);
    if (
      submittedIds.length !== factIds.length
      || submittedIds.some((factId) => !factIds.includes(factId))
      || factIds.some((factId) => !["preserved", "partial", "missing", "contradicted"]
        .includes(review.factVerdicts[factId]!))
    ) {
      throw new Error(`human review ${review.runId} does not cover every known fact`);
    }
    reviews.set(review.runId, review);
  }
  if (reviews.size !== validated.resultsByRunId.size) {
    throw new Error(`human review export requires ${validated.resultsByRunId.size} completed runs`);
  }

  return {
    reviews,
    advisory: {
      ...advisory,
      runs: advisory.runs.map((run) => {
      const review = reviews.get(run.runId)!;
      const result = validated.resultsByRunId.get(run.runId)!;
      const fixture = validated.fixtures.find((candidate) => candidate.id === result.fixtureId)!;
      const exceptions = Object.fromEntries(allFacts(fixture).flatMap((fact) => {
        const verdict = review.factVerdicts[fact.id]!;
        if (verdict === "preserved") {
          return [];
        }
        const original = run.exceptions[fact.id];
        const note = review.note.trim().length > 0
          ? review.note.trim()
          : original?.verdict === verdict
            ? original.note
            : `Human reviewer selected ${verdict} after comparing the exact input and output.`;
        return [[fact.id, { verdict, note }]];
      }));
        return {
          ...run,
          exceptions,
          repeatedFailedPaths: [...review.repeatedFailedPaths],
          unsupportedClaims: [...review.unsupportedClaims]
        };
      })
    }
  };
}

export function finalizeBenchmarkReviewFromExport(
  fixtures: readonly ReviewFixture[],
  results: readonly TargetRunResult[],
  canonicalMeasurements: readonly CanonicalCapsuleMeasurement[],
  advisory: AdvisoryVerdictSet,
  humanReview: HumanReviewExport,
  confirmationSource: string
): MaterializedBenchmarkReview {
  if (confirmationSource.trim().length === 0) {
    throw new Error("finalization requires an auditable confirmation source");
  }
  const adjusted = humanAdjustedReview(fixtures, results, advisory, humanReview);
  const materialized = finalizeBenchmarkReview(
    fixtures,
    results,
    canonicalMeasurements,
    adjusted.advisory,
    {
      confirmed: true,
      humanReviewer: humanReview.humanReviewer,
      reviewedAt: humanReview.exportedAt,
      confirmationSource
    },
    adjusted.reviews
  );
  return { ...materialized, humanReview };
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\r\n", "<br>").replaceAll("\n", "<br>");
}

export function renderReviewPacket(
  fixtures: readonly ReviewFixture[],
  results: readonly TargetRunResult[],
  advisory: AdvisoryVerdictSet
): string {
  const validated = validateReviewInputs(fixtures, results, advisory);
  const firstResult = [...validated.resultsByRunId.values()][0]!;
  const sections: string[] = [];
  let index = 0;
  for (const fixture of validated.fixtures) {
    for (const mode of modes) {
      index += 1;
      const runId = `${fixture.id}:${mode}:initial`;
      const result = validated.resultsByRunId.get(runId)!;
      const run = validated.advisoryByRunId.get(runId)!;
      const rows = categories.flatMap((category) => factsForCategory(fixture, category).map((fact) => {
        const exception = run.exceptions[fact.id];
        return `| ${category} | ${fact.id} | ${markdownCell(fact.text)} | ${exception?.verdict ?? "preserved"} | ${markdownCell(exception?.note ?? "AI suggests that the target output preserves this fact; human confirmation required.")} |`;
      })).join("\n");
      sections.push(`## ${index}. ${runId}

- [ ] Human checked every fact and the target output for this run.
- Repeated failed paths suggested: ${(run.repeatedFailedPaths ?? advisory.defaultRepeatedFailedPaths).length === 0 ? "None" : (run.repeatedFailedPaths ?? advisory.defaultRepeatedFailedPaths).join("; ")}
- Unsupported claims suggested: ${(run.unsupportedClaims ?? advisory.defaultUnsupportedClaims).length === 0 ? "None" : (run.unsupportedClaims ?? advisory.defaultUnsupportedClaims).join("; ")}

### Target output

~~~text
${result.output.text}
~~~

### Ground truth and advisory verdicts

| Category | Fact ID | Ground truth | Suggested verdict | Advisory note |
| --- | --- | --- | --- | --- |
${rows}
`);
    }
  }
  return `# AgentCarry ${advisory.benchmarkId} review packet

> **HUMAN REVIEW REQUIRED.** This packet contains AI suggestions, not final human-owned verdicts.

- Runs: ${validated.resultsByRunId.size}
- Target: ${firstResult.target.agent} / ${firstResult.target.model}
- Provider route: ${firstResult.target.provider}
- Advisory reviewer: ${advisory.reviewer.name} (advisory only)

Review every output and every fact. Check each run only after verifying the
suggested verdict and note. Record corrections by run ID and fact ID; do not
approve this packet based only on the aggregate preview.

${sections.join("\n")}`;
}
