const modes = [
    "visible-transcript",
    "deterministic-capsule",
    "source-assisted-capsule"
];
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function round(value, digits) {
    const scale = 10 ** digits;
    return Math.round((value + Number.EPSILON) * scale) / scale;
}
function canonicalize(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => compareText(left, right))
            .map(([key, nested]) => [key, canonicalize(nested)]));
    }
    return value;
}
function canonicalJsonValue(value) {
    return JSON.stringify(canonicalize(value));
}
function assertComplete(resultSet, expectedFixtureIds) {
    if (resultSet.schemaVersion !== "2.0.0" || resultSet.benchmarkId.trim().length === 0) {
        throw new Error("benchmark result set requires schema version 2.0.0 and a non-empty id");
    }
    const fixtureIds = [...new Set(expectedFixtureIds)].sort(compareText);
    if (fixtureIds.length !== 12) {
        throw new Error(`benchmark requires exactly 12 unique fixtures; received ${fixtureIds.length}`);
    }
    if (resultSet.reports.length !== fixtureIds.length * modes.length) {
        throw new Error(`benchmark requires exactly 36 initial reports; received ${resultSet.reports.length}`);
    }
    const runIds = new Set();
    const reports = new Map();
    let fixedOverhead;
    for (const report of resultSet.reports) {
        if (report.schemaVersion !== "2.0.0"
            || report.tokens.method !== "target-calibration-delta-v1"
            || report.tokens.fullCallInput - report.tokens.fixedOverhead
                !== report.tokens.agentCarryPayload) {
            throw new Error(`run ${report.runId} has invalid Benchmark v2 token metering`);
        }
        fixedOverhead ??= report.tokens.fixedOverhead;
        if (report.tokens.fixedOverhead !== fixedOverhead) {
            throw new Error(`fixed target overhead differs in run ${report.runId}`);
        }
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
            throw new Error(`unexpected mode ${report.mode}`);
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
        const baseline = reports.get(`${fixtureId}:visible-transcript`);
        if (baseline.tokens.agentCarryPayload
            !== baseline.tokens.visibleTranscriptPayloadBaseline) {
            throw new Error(`visible baseline payload token count mismatch for ${fixtureId}`);
        }
        for (const mode of modes) {
            if (reports.get(`${fixtureId}:${mode}`).tokens.visibleTranscriptPayloadBaseline
                !== baseline.tokens.visibleTranscriptPayloadBaseline) {
                throw new Error(`visible baseline token reference differs for ${fixtureId}`);
            }
        }
    }
    return reports;
}
function assertSameTarget(reports) {
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
function assertReruns(resultSet, initialRunIds) {
    const rerunIds = new Set();
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
function summarize(mode, reports) {
    const canonicalBaselines = reports.flatMap((report) => report.tokens.canonicalWorkCapsulePayloadBaseline === null
        ? []
        : [report.tokens.canonicalWorkCapsulePayloadBaseline]);
    const canonicalRatios = reports.flatMap((report) => report.tokens.canonicalCompressionRatio === null
        ? []
        : [report.tokens.canonicalCompressionRatio]);
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
        meanFullCallInputTokens: round(reports.reduce((sum, report) => sum + report.tokens.fullCallInput, 0) / reports.length, 2),
        meanFixedOverheadTokens: round(reports.reduce((sum, report) => sum + report.tokens.fixedOverhead, 0) / reports.length, 2),
        meanAgentCarryPayloadTokens: round(reports.reduce((sum, report) => sum + report.tokens.agentCarryPayload, 0) / reports.length, 2),
        meanVisibleTranscriptPayloadBaselineTokens: round(reports.reduce((sum, report) => sum + report.tokens.visibleTranscriptPayloadBaseline, 0) / reports.length, 2),
        meanVisibleTranscriptPayloadRatio: round(reports.reduce((sum, report) => sum + report.tokens.visibleTranscriptPayloadRatio, 0) / reports.length, 4),
        meanCanonicalWorkCapsulePayloadBaselineTokens: canonicalBaselines.length === 0
            ? null
            : round(canonicalBaselines.reduce((sum, value) => sum + value, 0) / canonicalBaselines.length, 2),
        meanCanonicalCompressionRatio: canonicalRatios.length === 0
            ? null
            : round(canonicalRatios.reduce((sum, value) => sum + value, 0) / canonicalRatios.length, 4),
        canonicalCompressionAtMost40PercentRuns: reports.filter((report) => report.gates.canonicalCompressionAtMost40Percent === true).length
    };
}
function capsuleGates(mode, fixtureIds, reports) {
    const comparisons = fixtureIds.map((fixtureId) => ({
        capsule: reports.get(`${fixtureId}:${mode}`),
        baseline: reports.get(`${fixtureId}:visible-transcript`)
    }));
    const meanFidelityDelta = round(comparisons.reduce((sum, { capsule, baseline }) => sum + capsule.fidelityScore - baseline.fidelityScore, 0) / comparisons.length, 2);
    const unsupportedClaimDelta = comparisons.reduce((sum, { capsule, baseline }) => sum + capsule.unsupportedClaims.length - baseline.unsupportedClaims.length, 0);
    const gates = {
        fidelityNoWorseThanBaseline: comparisons.every(({ capsule, baseline }) => capsule.fidelityScore >= baseline.fidelityScore),
        criticalConstraints100Percent: comparisons.every(({ capsule }) => capsule.gates.criticalConstraints100Percent),
        correctNextAction: comparisons.every(({ capsule }) => capsule.gates.correctNextAction),
        noRepeatedFailedPaths: comparisons.every(({ capsule }) => capsule.repeatedFailedPaths.length === 0),
        unsupportedClaimsNoWorseThanBaseline: comparisons.every(({ capsule, baseline }) => capsule.unsupportedClaims.length <= baseline.unsupportedClaims.length),
        canonicalCompressionAtMost40Percent: comparisons.every(({ capsule }) => capsule.gates.canonicalCompressionAtMost40Percent === true)
    };
    return {
        mode,
        meanFidelityDelta,
        unsupportedClaimDelta,
        ...gates,
        passed: Object.values(gates).every(Boolean)
    };
}
export function aggregateBenchmark(resultSet, expectedFixtureIds) {
    const fixtureIds = [...new Set(expectedFixtureIds)].sort(compareText);
    const reports = assertComplete(resultSet, fixtureIds);
    assertSameTarget(resultSet.reports);
    assertReruns(resultSet, new Set(resultSet.reports.map((report) => report.runId)));
    const modeSummaries = modes.map((mode) => summarize(mode, fixtureIds.map((fixtureId) => reports.get(`${fixtureId}:${mode}`))));
    const gates = ["deterministic-capsule", "source-assisted-capsule"]
        .map((mode) => capsuleGates(mode, fixtureIds, reports));
    return {
        schemaVersion: "2.0.0",
        benchmarkId: resultSet.benchmarkId,
        expectedRuns: 36,
        initialRuns: resultSet.reports.length,
        fixtureIds,
        target: resultSet.reports[0].target,
        modes: modeSummaries,
        capsuleGates: gates,
        benchmarkV2Passed: gates.some((gate) => gate.passed),
        reruns: [...resultSet.reruns]
    };
}
function mark(value) {
    return value ? "PASS" : "FAIL";
}
export function renderAggregateMarkdown(report) {
    const formatOptional = (value, digits) => value === null ? "N/A" : value.toFixed(digits);
    const modeRows = report.modes.map((mode) => `| ${mode.mode} | ${mode.runs} | ${mode.meanFidelity.toFixed(2)} | ${mode.criticalConstraintPasses}/12 | ${mode.correctNextActionRuns}/12 | ${mode.repeatedFailedPathRuns}/${mode.repeatedFailedPaths} | ${mode.unsupportedClaimRuns}/${mode.unsupportedClaims} | ${mode.meanFullCallInputTokens.toFixed(2)} | ${mode.meanFixedOverheadTokens.toFixed(2)} | ${mode.meanAgentCarryPayloadTokens.toFixed(2)} | ${mode.meanVisibleTranscriptPayloadBaselineTokens.toFixed(2)} | ${mode.meanVisibleTranscriptPayloadRatio.toFixed(4)} | ${formatOptional(mode.meanCanonicalWorkCapsulePayloadBaselineTokens, 2)} | ${formatOptional(mode.meanCanonicalCompressionRatio, 4)} |`).join("\n");
    const gateRows = report.capsuleGates.map((gate) => `| ${gate.mode} | ${gate.meanFidelityDelta >= 0 ? "+" : ""}${gate.meanFidelityDelta.toFixed(2)} | ${mark(gate.fidelityNoWorseThanBaseline)} | ${mark(gate.criticalConstraints100Percent)} | ${mark(gate.correctNextAction)} | ${mark(gate.noRepeatedFailedPaths)} | ${gate.unsupportedClaimDelta >= 0 ? "+" : ""}${gate.unsupportedClaimDelta} | ${mark(gate.unsupportedClaimsNoWorseThanBaseline)} | ${mark(gate.canonicalCompressionAtMost40Percent)} | ${mark(gate.passed)} |`).join("\n");
    const reruns = report.reruns.length === 0
        ? "None."
        : report.reruns.map((rerun) => `- ${rerun.rerunRunId} reran ${rerun.originalRunId}: ${rerun.reason} Resolution: ${rerun.resolution}`).join("\n");
    return `# AgentCarry continuity benchmark: ${report.benchmarkId}

- Initial runs: ${report.initialRuns} / ${report.expectedRuns}
- Target: ${report.target.agent} / ${report.target.model}
- Provider route: ${report.target.provider}
- Target settings: \`${canonicalJsonValue(report.target.settings)}\`
- Benchmark v2: **${mark(report.benchmarkV2Passed)}**

| Mode | Runs | Mean fidelity | Critical constraints | Correct next action | Repeated runs/items | Unsupported runs/items | Mean full call | Mean fixed overhead | Mean AgentCarry payload | Mean visible payload baseline | Mean visible ratio | Mean canonical Capsule baseline | Mean canonical compression |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${modeRows}

## Capsule gates

Each comparison must pass fixture by fixture, not only on the aggregate mean.

| Mode | Mean fidelity delta | Every fidelity >= baseline | Critical 100% | Next action | No repeated path | Unsupported delta | Every unsupported <= baseline | Brief <= 40% canonical Capsule | All gates |
| --- | ---: | --- | --- | --- | --- | ---: | --- | --- | --- |
${gateRows}

## Reruns and disputes

${reruns}
`;
}
export function renderAggregateJson(report) {
    return `${JSON.stringify(canonicalize(report), null, 2)}\n`;
}
