import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateWorkCapsule } from "../capsule/validate-capsule.js";
import { buildDeterministicCapsule, buildVisibleTranscript, canonicalJson, sourceFingerprint } from "./build-handoff-input.js";
import { defaultProcessRunner, runSourceAssisted } from "./run-source-assisted.js";
import { createTargetCalibrationInvocation, createTargetSettings, runCanonicalCapsuleMeasurement, runTargetCalibration, runTargetContinuation } from "./run-target-continuation.js";
const modes = [
    "visible-transcript",
    "deterministic-capsule",
    "source-assisted-capsule"
];
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function sha256(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
export function createBenchmarkRunPlan(fixtures, model, options = {}) {
    if (model.trim().length === 0) {
        throw new Error("benchmark target model must be explicit and non-empty");
    }
    const fixtureIds = fixtures.map((fixture) => fixture.id);
    if (fixtures.length !== 12 || new Set(fixtureIds).size !== 12) {
        throw new Error(`benchmark run plan requires exactly 12 unique fixtures; received ${fixtures.length}`);
    }
    const provider = options.provider ?? "unspecified";
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider)) {
        throw new Error("benchmark provider must be a non-secret lowercase label");
    }
    const sortedFixtures = [...fixtures].sort((left, right) => compareText(left.id, right.id));
    const calibrationInvocation = createTargetCalibrationInvocation(model, options.settingSources === undefined ? {} : { settingSources: options.settingSources });
    return {
        schemaVersion: "2.0.0",
        benchmarkId: "second-36",
        target: {
            agent: "claude",
            model,
            provider,
            settings: createTargetSettings(options.settingSources)
        },
        metering: {
            method: "target-calibration-delta-v1",
            calibrationPromptSha256: sha256(calibrationInvocation.stdin),
            calibrationPromptUtf8Bytes: Buffer.byteLength(calibrationInvocation.stdin, "utf8")
        },
        runs: sortedFixtures.flatMap((fixture) => modes.map((mode) => ({
            runId: `${fixture.id}:${mode}:initial`,
            fixtureId: fixture.id,
            mode,
            sourceFingerprint: sourceFingerprint(fixture)
        })))
    };
}
function errorCode(error) {
    return error.code;
}
async function readJsonIfPresent(path) {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    }
    catch (error) {
        if (errorCode(error) === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}
async function writeJsonOnce(path, value) {
    await writeFile(path, canonicalJson(value), { encoding: "utf8", flag: "wx" });
}
function assertArtifact(value, expected, model) {
    const artifact = value;
    if (artifact?.schemaVersion !== "1.0.0"
        || artifact.fixtureId !== expected.fixtureId
        || artifact.mode !== expected.mode
        || artifact.sourceFingerprint !== expected.sourceFingerprint
        || typeof artifact.content !== "string"
        || artifact.content.length === 0) {
        throw new Error(`stored input does not match run plan for ${expected.runId}`);
    }
    if (artifact.mode !== "visible-transcript") {
        let capsule;
        try {
            capsule = JSON.parse(artifact.content);
        }
        catch {
            throw new Error(`stored capsule input is not valid JSON for ${expected.runId}`);
        }
        if (validateWorkCapsule(capsule).length > 0) {
            throw new Error(`stored capsule input is not Work Capsule v2 for ${expected.runId}`);
        }
    }
    if (expected.mode === "source-assisted-capsule"
        && artifact.generation.model !== model) {
        throw new Error(`stored source-assisted model differs for ${expected.runId}`);
    }
    return artifact;
}
function assertTargetResult(value, expected, plan, calibration) {
    const result = value;
    if (result?.schemaVersion !== "2.0.0"
        || result.runId !== expected.runId
        || result.fixtureId !== expected.fixtureId
        || result.mode !== expected.mode
        || result.sourceFingerprint !== expected.sourceFingerprint
        || canonicalJson(result.target) !== canonicalJson(plan.target)
        || !Number.isInteger(result.input?.fullCallInputTokens)
        || !Number.isInteger(result.input?.fixedOverheadInputTokens)
        || !Number.isInteger(result.input?.agentCarryPayload?.tokens)
        || result.input.fullCallInputTokens < result.input.fixedOverheadInputTokens
        || result.input.fixedOverheadInputTokens !== calibration.input.exactInputTokens
        || result.input.agentCarryPayload.tokens
            !== result.input.fullCallInputTokens - result.input.fixedOverheadInputTokens
        || typeof result.input.agentCarryPayload.text !== "string"
        || result.input.agentCarryPayload.text.length === 0
        || typeof result.output?.text !== "string"
        || result.output.text.length === 0
        || !/^[a-f0-9]{64}$/.test(result.input.promptSha256)
        || !/^[a-f0-9]{64}$/.test(result.input.agentCarryPayload.sha256)
        || !/^[a-f0-9]{64}$/.test(result.output.sha256)
        || result.input.promptSha256 !== result.invocation?.promptSha256
        || Number.isNaN(Date.parse(result.invocation?.startedAt))
        || Number.isNaN(Date.parse(result.invocation?.completedAt))) {
        throw new Error(`stored target result does not match run plan for ${expected.runId}`);
    }
    return result;
}
function assertCalibration(value, plan) {
    const calibration = value;
    if (calibration?.schemaVersion !== "2.0.0"
        || canonicalJson(calibration.target) !== canonicalJson(plan.target)
        || !Number.isInteger(calibration.input?.exactInputTokens)
        || calibration.input.exactInputTokens < 0
        || calibration.input.promptSha256 !== plan.metering.calibrationPromptSha256
        || calibration.input.promptUtf8Bytes !== plan.metering.calibrationPromptUtf8Bytes
        || Number.isNaN(Date.parse(calibration.invocation?.startedAt))
        || Number.isNaN(Date.parse(calibration.invocation?.completedAt))) {
        throw new Error("stored target calibration does not match the benchmark plan");
    }
    return calibration;
}
function assertCanonicalMeasurement(value, artifact, plan, calibration) {
    const measurement = value;
    if (artifact.mode === "visible-transcript"
        || measurement?.schemaVersion !== "2.0.0"
        || measurement.fixtureId !== artifact.fixtureId
        || measurement.mode !== artifact.mode
        || measurement.purpose !== "canonical-work-capsule-baseline"
        || measurement.sourceFingerprint !== artifact.sourceFingerprint
        || canonicalJson(measurement.target) !== canonicalJson(plan.target)
        || !Number.isInteger(measurement.input?.fullCallInputTokens)
        || !Number.isInteger(measurement.input?.fixedOverheadInputTokens)
        || !Number.isInteger(measurement.input?.canonicalWorkCapsulePayload?.tokens)
        || measurement.input.fixedOverheadInputTokens !== calibration.input.exactInputTokens
        || measurement.input.canonicalWorkCapsulePayload.tokens
            !== measurement.input.fullCallInputTokens - measurement.input.fixedOverheadInputTokens
        || measurement.input.canonicalWorkCapsulePayload.tokens < 1
        || measurement.input.canonicalWorkCapsulePayload.sha256 !== sha256(artifact.content)
        || measurement.input.canonicalWorkCapsulePayload.utf8Bytes
            !== Buffer.byteLength(artifact.content, "utf8")
        || !/^[a-f0-9]{64}$/.test(measurement.input.promptSha256)
        || !/^[a-f0-9]{64}$/.test(measurement.responseSha256)
        || Number.isNaN(Date.parse(measurement.invocation?.startedAt))
        || Number.isNaN(Date.parse(measurement.invocation?.completedAt))) {
        throw new Error(`stored canonical baseline does not match ${artifact.fixtureId}:${artifact.mode}`);
    }
    return measurement;
}
function fileStem(fixtureId, mode) {
    if (!/^[A-Za-z0-9._-]+$/.test(fixtureId)) {
        throw new Error(`fixture id is not safe for an artifact filename: ${fixtureId}`);
    }
    return `${fixtureId}--${mode}`;
}
async function ensurePlan(path, plan) {
    const existing = await readJsonIfPresent(path);
    if (existing === undefined) {
        await writeJsonOnce(path, plan);
        return;
    }
    if (canonicalJson(existing) !== canonicalJson(plan)) {
        throw new Error("existing benchmark plan differs from the requested model, settings, or fixtures");
    }
}
async function buildArtifact(fixture, mode, model, sourceAssistedBuilder) {
    if (mode === "visible-transcript") {
        return buildVisibleTranscript(fixture);
    }
    if (mode === "deterministic-capsule") {
        return buildDeterministicCapsule(fixture);
    }
    return await sourceAssistedBuilder(fixture, model);
}
export async function collectTargetRuns(fixtures, model, outputDirectory, dependencies = {}, options = {}) {
    const plan = createBenchmarkRunPlan(fixtures, model, options);
    const outputRoot = resolve(outputDirectory);
    const inputDirectory = join(outputRoot, "inputs");
    const resultDirectory = join(outputRoot, "results");
    const canonicalBaselineDirectory = join(outputRoot, "canonical-baselines");
    const targetWorkingDirectory = join(outputRoot, "target-cwd");
    await Promise.all([
        mkdir(inputDirectory, { recursive: true }),
        mkdir(resultDirectory, { recursive: true }),
        mkdir(canonicalBaselineDirectory, { recursive: true }),
        mkdir(targetWorkingDirectory, { recursive: true })
    ]);
    await ensurePlan(join(outputRoot, "plan.json"), plan);
    const calibrationPath = join(outputRoot, "calibration.json");
    const storedCalibration = await readJsonIfPresent(calibrationPath);
    const calibrationRunner = dependencies.calibrateTarget ?? (async (targetModel) => await runTargetCalibration(targetModel, {
        provider: plan.target.provider,
        settingSources: plan.target.settings.settingSources,
        workingDirectory: targetWorkingDirectory
    }));
    const calibration = storedCalibration === undefined
        ? await calibrationRunner(model)
        : assertCalibration(storedCalibration, plan);
    if (storedCalibration === undefined) {
        assertCalibration(calibration, plan);
        await writeJsonOnce(calibrationPath, calibration);
        dependencies.onProgress?.("calibration target-fixed-overhead");
    }
    const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
    const sourceAssistedBuilder = dependencies.buildSourceAssisted
        ?? (async (fixture, sourceModel) => await runSourceAssisted(fixture, sourceModel, defaultProcessRunner, { settingSources: plan.target.settings.settingSources }));
    const targetRunner = dependencies.runTarget ?? (async (artifact, targetModel, targetCalibration) => await runTargetContinuation(artifact, targetModel, {
        provider: plan.target.provider,
        settingSources: plan.target.settings.settingSources,
        calibration: targetCalibration,
        workingDirectory: targetWorkingDirectory
    }));
    const canonicalCapsuleRunner = dependencies.measureCanonicalCapsule
        ?? (async (artifact, targetModel, targetCalibration) => await runCanonicalCapsuleMeasurement(artifact, targetModel, {
            provider: plan.target.provider,
            settingSources: plan.target.settings.settingSources,
            calibration: targetCalibration,
            workingDirectory: targetWorkingDirectory
        }));
    let completed = 0;
    let skipped = 0;
    for (const plannedRun of plan.runs) {
        const fixture = fixtureById.get(plannedRun.fixtureId);
        const stem = fileStem(plannedRun.fixtureId, plannedRun.mode);
        const inputPath = join(inputDirectory, `${stem}.json`);
        const resultPath = join(resultDirectory, `${stem}.json`);
        const storedInput = await readJsonIfPresent(inputPath);
        const artifact = storedInput === undefined
            ? await buildArtifact(fixture, plannedRun.mode, model, sourceAssistedBuilder)
            : assertArtifact(storedInput, plannedRun, model);
        if (storedInput === undefined) {
            assertArtifact(artifact, plannedRun, model);
            await writeJsonOnce(inputPath, artifact);
            dependencies.onProgress?.(`input ${plannedRun.runId}`);
        }
        if (artifact.mode !== "visible-transcript") {
            const baselinePath = join(canonicalBaselineDirectory, `${stem}.json`);
            const storedBaseline = await readJsonIfPresent(baselinePath);
            if (storedBaseline === undefined) {
                const baseline = await canonicalCapsuleRunner(artifact, model, calibration);
                assertCanonicalMeasurement(baseline, artifact, plan, calibration);
                await writeJsonOnce(baselinePath, baseline);
                dependencies.onProgress?.(`canonical-baseline ${plannedRun.runId}`);
            }
            else {
                assertCanonicalMeasurement(storedBaseline, artifact, plan, calibration);
                dependencies.onProgress?.(`skip-canonical-baseline ${plannedRun.runId}`);
            }
        }
        const storedResult = await readJsonIfPresent(resultPath);
        if (storedResult !== undefined) {
            assertTargetResult(storedResult, plannedRun, plan, calibration);
            skipped += 1;
            dependencies.onProgress?.(`skip ${plannedRun.runId}`);
            continue;
        }
        const result = await targetRunner(artifact, model, calibration);
        assertTargetResult(result, plannedRun, plan, calibration);
        await writeJsonOnce(resultPath, result);
        completed += 1;
        dependencies.onProgress?.(`result ${plannedRun.runId}`);
    }
    return {
        schemaVersion: "2.0.0",
        benchmarkId: "second-36",
        outputDirectory: outputRoot,
        planned: plan.runs.length,
        completed,
        skipped
    };
}
