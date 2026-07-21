import type {
  ContinuationScoreReport
} from "./score-assessment.js";

const modes = [
  "visible-transcript",
  "deterministic-capsule",
  "source-assisted-capsule"
] as const;

type Mode = typeof modes[number];
type CapsuleMode = Exclude<Mode, "visible-transcript">;

export interface RerunDisclosure {
  readonly originalRunId: string;
  readonly rerunRunId: string;
  readonly reason: string;
  readonly resolution: string;
  readonly includedInAggregate: false;
}

export interface BenchmarkResultSet {
  readonly schemaVersion: "1.0.0";
  readonly benchmarkId: string;
  readonly reports: readonly ContinuationScoreReport[];
  readonly reruns: readonly RerunDisclosure[];
}

export interface BenchmarkModeSummary {
  readonly mode: Mode;
  readonly runs: number;
  readonly meanFidelity: number;
  readonly criticalConstraintPasses: number;
  readonly correctNextActionRuns: number;
  readonly repeatedFailedPathRuns: number;
  readonly repeatedFailedPaths: number;
  readonly unsupportedClaimRuns: number;
  readonly unsupportedClaims: number;
  readonly meanTokenRatio: number;
  readonly tokenRatioAtMost40PercentRuns: number;
}

export interface CapsuleModeGates {
  readonly mode: CapsuleMode;
  readonly meanFidelityDelta: number;
  readonly unsupportedClaimDelta: number;
  readonly fidelityNoWorseThanBaseline: boolean;
  readonly criticalConstraints100Percent: boolean;
  readonly correctNextAction: boolean;
  readonly noRepeatedFailedPaths: boolean;
  readonly unsupportedClaimsNoWorseThanBaseline: boolean;
  readonly tokenRatioAtMost40Percent: boolean;
  readonly passed: boolean;
}

export interface AggregateBenchmarkReport {
  readonly schemaVersion: "1.0.0";
  readonly benchmarkId: string;
  readonly expectedRuns: number;
  readonly initialRuns: number;
  readonly fixtureIds: readonly string[];
  readonly target: ContinuationScoreReport["target"];
  readonly modes: readonly BenchmarkModeSummary[];
  readonly capsuleGates: readonly CapsuleModeGates[];
  readonly phase0Passed: boolean;
  readonly reruns: readonly RerunDisclosure[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

function canonicalJsonValue(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function assertComplete(
  resultSet: BenchmarkResultSet,
  expectedFixtureIds: readonly string[]
): Map<string, ContinuationScoreReport> {
  if (resultSet.schemaVersion !== "1.0.0" || resultSet.benchmarkId.trim().length === 0) {
    throw new Error("benchmark result set requires schema version 1.0.0 and a non-empty id");
  }
  const fixtureIds = [...new Set(expectedFixtureIds)].sort(compareText);
  if (fixtureIds.length !== 12) {
    throw new Error(`benchmark requires exactly 12 unique fixtures; received ${fixtureIds.length}`);
  }
  if (resultSet.reports.length !== fixtureIds.length * modes.length) {
    throw new Error(`benchmark requires exactly 36 initial reports; received ${resultSet.reports.length}`);
  }

  const runIds = new Set<string>();
  const reports = new Map<string, ContinuationScoreReport>();
  for (const report of resultSet.reports) {
    if (report.reviewer.trim().length === 0 || Number.isNaN(Date.parse(report.reviewedAt))) {
      throw new Error(`run ${report.runId} requires an identifiable human review and timestamp`);
    }
    if (runIds.has(report.runId)) {
      throw new Error(`duplicate run id ${report.runId}`);
    }
    runIds.add(report.runId);
    if (!fixtureIds.includes(report.fixtureId)) {
      throw new Error(`unexpected fixture ${report.fixtureId}`);
    }
    if (!modes.includes(report.mode)) {
      throw new Error(`unexpected mode ${report.mode as string}`);
    }
    const key = `${report.fixtureId}:${report.mode}`;
    if (reports.has(key)) {
      throw new Error(`duplicate initial report ${key}`);
    }
    reports.set(key, report);
  }
  for (const fixtureId of fixtureIds) {
    for (const mode of modes) {
      const key = `${fixtureId}:${mode}`;
      if (!reports.has(key)) {
        throw new Error(`missing initial report ${key}`);
      }
    }
    const baseline = reports.get(`${fixtureId}:visible-transcript`)!;
    if (baseline.tokens.input !== baseline.tokens.visibleTranscriptBaseline) {
      throw new Error(`visible baseline token count mismatch for ${fixtureId}`);
    }
    for (const mode of modes) {
      if (
        reports.get(`${fixtureId}:${mode}`)!.tokens.visibleTranscriptBaseline
        !== baseline.tokens.visibleTranscriptBaseline
      ) {
        throw new Error(`visible baseline token reference differs for ${fixtureId}`);
      }
    }
  }
  return reports;
}

function assertSameTarget(reports: readonly ContinuationScoreReport[]): void {
  const first = reports[0];
  if (first === undefined) {
    throw new Error("benchmark result set is empty");
  }
  const expected = canonicalJsonValue(first.target);
  const mixed = reports.find((report) => canonicalJsonValue(report.target) !== expected);
  if (mixed !== undefined) {
    throw new Error(`target settings differ in run ${mixed.runId}`);
  }
}

function assertReruns(resultSet: BenchmarkResultSet, initialRunIds: ReadonlySet<string>): void {
  const rerunIds = new Set<string>();
  for (const rerun of resultSet.reruns) {
    if (!initialRunIds.has(rerun.originalRunId)) {
      throw new Error(`rerun references unknown initial run ${rerun.originalRunId}`);
    }
    if (initialRunIds.has(rerun.rerunRunId) || rerunIds.has(rerun.rerunRunId)) {
      throw new Error(`duplicate rerun id ${rerun.rerunRunId}`);
    }
    if (rerun.reason.trim().length === 0 || rerun.resolution.trim().length === 0) {
      throw new Error(`rerun ${rerun.rerunRunId} requires reason and resolution`);
    }
    if (rerun.includedInAggregate !== false) {
      throw new Error(`rerun ${rerun.rerunRunId} must not replace an initial result`);
    }
    rerunIds.add(rerun.rerunRunId);
  }
}

function summarize(mode: Mode, reports: readonly ContinuationScoreReport[]): BenchmarkModeSummary {
  return {
    mode,
    runs: reports.length,
    meanFidelity: round(reports.reduce((sum, report) => sum + report.fidelityScore, 0) / reports.length, 2),
    criticalConstraintPasses: reports.filter((report) => report.gates.criticalConstraints100Percent).length,
    correctNextActionRuns: reports.filter((report) => report.gates.correctNextAction).length,
    repeatedFailedPathRuns: reports.filter((report) => report.repeatedFailedPaths.length > 0).length,
    repeatedFailedPaths: reports.reduce((sum, report) => sum + report.repeatedFailedPaths.length, 0),
    unsupportedClaimRuns: reports.filter((report) => report.unsupportedClaims.length > 0).length,
    unsupportedClaims: reports.reduce((sum, report) => sum + report.unsupportedClaims.length, 0),
    meanTokenRatio: round(reports.reduce((sum, report) => sum + report.tokens.ratio, 0) / reports.length, 4),
    tokenRatioAtMost40PercentRuns: reports.filter((report) => report.gates.tokenRatioAtMost40Percent).length
  };
}

function capsuleGates(
  mode: CapsuleMode,
  fixtureIds: readonly string[],
  reports: ReadonlyMap<string, ContinuationScoreReport>
): CapsuleModeGates {
  const comparisons = fixtureIds.map((fixtureId) => ({
    capsule: reports.get(`${fixtureId}:${mode}`)!,
    baseline: reports.get(`${fixtureId}:visible-transcript`)!
  }));
  const meanFidelityDelta = round(
    comparisons.reduce((sum, { capsule, baseline }) =>
      sum + capsule.fidelityScore - baseline.fidelityScore, 0) / comparisons.length,
    2
  );
  const unsupportedClaimDelta = comparisons.reduce((sum, { capsule, baseline }) =>
    sum + capsule.unsupportedClaims.length - baseline.unsupportedClaims.length, 0
  );
  const gates = {
    fidelityNoWorseThanBaseline: comparisons.every(({ capsule, baseline }) =>
      capsule.fidelityScore >= baseline.fidelityScore
    ),
    criticalConstraints100Percent: comparisons.every(({ capsule }) =>
      capsule.gates.criticalConstraints100Percent
    ),
    correctNextAction: comparisons.every(({ capsule }) => capsule.gates.correctNextAction),
    noRepeatedFailedPaths: comparisons.every(({ capsule }) =>
      capsule.repeatedFailedPaths.length === 0
    ),
    unsupportedClaimsNoWorseThanBaseline: comparisons.every(({ capsule, baseline }) =>
      capsule.unsupportedClaims.length <= baseline.unsupportedClaims.length
    ),
    tokenRatioAtMost40Percent: comparisons.every(({ capsule }) =>
      capsule.gates.tokenRatioAtMost40Percent
    )
  };
  return {
    mode,
    meanFidelityDelta,
    unsupportedClaimDelta,
    ...gates,
    passed: Object.values(gates).every(Boolean)
  };
}

export function aggregateBenchmark(
  resultSet: BenchmarkResultSet,
  expectedFixtureIds: readonly string[]
): AggregateBenchmarkReport {
  const fixtureIds = [...new Set(expectedFixtureIds)].sort(compareText);
  const reports = assertComplete(resultSet, fixtureIds);
  assertSameTarget(resultSet.reports);
  assertReruns(resultSet, new Set(resultSet.reports.map((report) => report.runId)));
  const modeSummaries = modes.map((mode) => summarize(
    mode,
    fixtureIds.map((fixtureId) => reports.get(`${fixtureId}:${mode}`)!)
  ));
  const gates = (["deterministic-capsule", "source-assisted-capsule"] as const)
    .map((mode) => capsuleGates(mode, fixtureIds, reports));
  return {
    schemaVersion: "1.0.0",
    benchmarkId: resultSet.benchmarkId,
    expectedRuns: 36,
    initialRuns: resultSet.reports.length,
    fixtureIds,
    target: resultSet.reports[0]!.target,
    modes: modeSummaries,
    capsuleGates: gates,
    phase0Passed: gates.some((gate) => gate.passed),
    reruns: [...resultSet.reruns]
  };
}

function mark(value: boolean): "PASS" | "FAIL" {
  return value ? "PASS" : "FAIL";
}

export function renderAggregateMarkdown(report: AggregateBenchmarkReport): string {
  const modeRows = report.modes.map((mode) =>
    `| ${mode.mode} | ${mode.runs} | ${mode.meanFidelity.toFixed(2)} | ${mode.criticalConstraintPasses}/12 | ${mode.correctNextActionRuns}/12 | ${mode.repeatedFailedPathRuns}/${mode.repeatedFailedPaths} | ${mode.unsupportedClaimRuns}/${mode.unsupportedClaims} | ${mode.meanTokenRatio.toFixed(4)} |`
  ).join("\n");
  const gateRows = report.capsuleGates.map((gate) =>
    `| ${gate.mode} | ${gate.meanFidelityDelta >= 0 ? "+" : ""}${gate.meanFidelityDelta.toFixed(2)} | ${mark(gate.fidelityNoWorseThanBaseline)} | ${mark(gate.criticalConstraints100Percent)} | ${mark(gate.correctNextAction)} | ${mark(gate.noRepeatedFailedPaths)} | ${gate.unsupportedClaimDelta >= 0 ? "+" : ""}${gate.unsupportedClaimDelta} | ${mark(gate.unsupportedClaimsNoWorseThanBaseline)} | ${mark(gate.tokenRatioAtMost40Percent)} | ${mark(gate.passed)} |`
  ).join("\n");
  const reruns = report.reruns.length === 0
    ? "None."
    : report.reruns.map((rerun) =>
      `- ${rerun.rerunRunId} reran ${rerun.originalRunId}: ${rerun.reason} Resolution: ${rerun.resolution}`
    ).join("\n");
  return `# AgentCarry continuity benchmark: ${report.benchmarkId}

- Initial runs: ${report.initialRuns} / ${report.expectedRuns}
- Target: ${report.target.agent} / ${report.target.model}
- Provider route: ${report.target.provider}
- Target settings: \`${canonicalJsonValue(report.target.settings)}\`
- Phase 0: **${mark(report.phase0Passed)}**

| Mode | Runs | Mean fidelity | Critical constraints | Correct next action | Repeated runs/items | Unsupported runs/items | Mean token ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${modeRows}

## Capsule gates

Each comparison must pass fixture by fixture, not only on the aggregate mean.

| Mode | Mean fidelity delta | Every fidelity >= baseline | Critical 100% | Next action | No repeated path | Unsupported delta | Every unsupported <= baseline | Tokens <= 40% | All gates |
| --- | ---: | --- | --- | --- | --- | ---: | --- | --- | --- |
${gateRows}

## Reruns and disputes

${reruns}
`;
}

export function renderAggregateJson(report: AggregateBenchmarkReport): string {
  return `${JSON.stringify(canonicalize(report), null, 2)}\n`;
}
