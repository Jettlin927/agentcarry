import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderContinuationBrief } from "../adapters/claude/target-launcher.js";
import { canonicalJson } from "./build-handoff-input.js";
import { totalInputTokens } from "./claude-usage.js";
import { defaultProcessRunner } from "./run-source-assisted.js";
const systemPrompt = `You are evaluating a coding-task handoff.
Use only the supplied handoff input. Do not use tools, inspect files, or invent state.
Return a concise continuation brief that states the objective, critical constraints,
current state, decisions, failed attempts, completed work, pending work, and the
single correct next action. Do not perform that action or claim new validation.`;
function sha256(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
export function createTargetSettings(settingSources = "none") {
    return {
        permissionMode: "plan",
        maxTurns: 1,
        tools: "disabled",
        persistence: "disabled",
        slashCommands: "disabled",
        mcp: "empty-strict",
        settingSources,
        systemPromptSha256: sha256(systemPrompt)
    };
}
export const targetSettings = createTargetSettings();
function targetPrompt(payload) {
    return `Continue from this handoff input. Preserve qualifiers and explicitly avoid recorded failed paths.

HANDOFF INPUT
${payload}`;
}
export function targetPayload(artifact) {
    if (artifact.mode === "visible-transcript") {
        return artifact.content;
    }
    return renderContinuationBrief(JSON.parse(artifact.content));
}
function invocationForPayload(payload, model, settingSources) {
    if (model.trim().length === 0) {
        throw new Error("target model must be explicit and non-empty");
    }
    const settings = createTargetSettings(settingSources);
    return {
        command: "claude",
        args: [
            "--print",
            "--no-session-persistence",
            "--tools",
            "",
            "--disable-slash-commands",
            "--strict-mcp-config",
            "--mcp-config",
            "{\"mcpServers\":{}}",
            "--permission-mode",
            "plan",
            "--setting-sources",
            settings.settingSources === "none" ? "" : settings.settingSources,
            "--max-turns",
            "1",
            "--system-prompt",
            systemPrompt,
            "--output-format",
            "json",
            "--model",
            model
        ],
        stdin: targetPrompt(payload),
        model,
        settings,
        payload
    };
}
export function createTargetInvocation(artifact, model, options = {}) {
    return invocationForPayload(targetPayload(artifact), model, options.settingSources);
}
export function createTargetCalibrationInvocation(model, options = {}) {
    return invocationForPayload("", model, options.settingSources);
}
export function createCanonicalCapsuleMeasurementInvocation(artifact, model, options = {}) {
    if (artifact.mode === "visible-transcript") {
        throw new Error("canonical Work Capsule measurement requires a capsule mode");
    }
    return invocationForPayload(artifact.content, model, options.settingSources);
}
async function executeTarget(invocation, runner, now, workingDirectory) {
    const startedAt = now().toISOString();
    const temporaryDirectory = workingDirectory
        ?? await mkdtemp(join(tmpdir(), "agentcarry-target-run-"));
    if (workingDirectory !== undefined) {
        await mkdir(workingDirectory, { recursive: true });
    }
    try {
        const processResult = await runner(invocation.command, invocation.args, {
            cwd: temporaryDirectory,
            stdin: invocation.stdin
        });
        if (processResult.exitCode !== 0) {
            const details = processResult.stderr.trim()
                || processResult.stdout.trim()
                || `exit code ${processResult.exitCode}`;
            throw new Error(`target continuation failed (${processResult.exitCode}): ${details}`);
        }
        const envelope = JSON.parse(processResult.stdout);
        if (envelope.is_error === true
            || envelope.result === undefined
            || envelope.result.trim().length === 0) {
            throw new Error("target continuation returned no successful result text");
        }
        return { envelope, startedAt, completedAt: now().toISOString() };
    }
    finally {
        if (workingDirectory === undefined) {
            await rm(temporaryDirectory, { recursive: true, force: true });
        }
    }
}
export async function runTargetCalibration(model, options = {}) {
    const invocation = createTargetCalibrationInvocation(model, options);
    const { envelope, startedAt, completedAt } = await executeTarget(invocation, options.runner ?? defaultProcessRunner, options.now ?? (() => new Date()), options.workingDirectory);
    return {
        schemaVersion: "2.0.0",
        target: {
            agent: "claude",
            model,
            provider: options.provider ?? "unspecified",
            settings: invocation.settings
        },
        input: {
            promptSha256: sha256(invocation.stdin),
            promptUtf8Bytes: Buffer.byteLength(invocation.stdin, "utf8"),
            exactInputTokens: totalInputTokens(envelope.usage)
        },
        invocation: { startedAt, completedAt }
    };
}
export async function runTargetContinuation(artifact, model, options = {}) {
    const invocation = createTargetInvocation(artifact, model, options);
    const runner = options.runner ?? defaultProcessRunner;
    const now = options.now ?? (() => new Date());
    if (options.calibration === undefined) {
        throw new Error("Benchmark v2 target run requires fixed-overhead calibration");
    }
    const expectedTarget = {
        agent: "claude",
        model,
        provider: options.provider ?? "unspecified",
        settings: invocation.settings
    };
    if (canonicalJson(options.calibration.target) !== canonicalJson(expectedTarget)) {
        throw new Error("target calibration does not match the target model, provider, and settings");
    }
    const { envelope, startedAt, completedAt } = await executeTarget(invocation, runner, now, options.workingDirectory);
    const resultText = envelope.result;
    if (resultText === undefined) {
        throw new Error("target continuation returned no successful result text");
    }
    const fullCallInputTokens = totalInputTokens(envelope.usage);
    const fixedOverheadInputTokens = options.calibration.input.exactInputTokens;
    const payloadTokens = fullCallInputTokens - fixedOverheadInputTokens;
    if (payloadTokens < 0) {
        throw new Error("target input tokens are lower than the calibrated fixed overhead");
    }
    const payload = targetPayload(artifact);
    return {
        schemaVersion: "2.0.0",
        runId: `${artifact.fixtureId}:${artifact.mode}:initial`,
        fixtureId: artifact.fixtureId,
        mode: artifact.mode,
        sourceFingerprint: artifact.sourceFingerprint,
        target: {
            agent: "claude",
            model,
            provider: options.provider ?? "unspecified",
            settings: invocation.settings
        },
        input: {
            promptSha256: sha256(invocation.stdin),
            promptUtf8Bytes: Buffer.byteLength(invocation.stdin, "utf8"),
            fullCallInputTokens,
            fixedOverheadInputTokens,
            agentCarryPayload: {
                contentType: artifact.mode === "visible-transcript"
                    ? artifact.contentType
                    : "text/markdown",
                text: payload,
                sha256: sha256(payload),
                utf8Bytes: Buffer.byteLength(payload, "utf8"),
                tokens: payloadTokens
            }
        },
        output: {
            text: resultText,
            sha256: sha256(resultText)
        },
        invocation: {
            promptSha256: sha256(invocation.stdin),
            startedAt,
            completedAt
        }
    };
}
export async function runCanonicalCapsuleMeasurement(artifact, model, options = {}) {
    if (artifact.mode === "visible-transcript") {
        throw new Error("canonical Work Capsule measurement requires a capsule mode");
    }
    if (options.calibration === undefined) {
        throw new Error("canonical Work Capsule measurement requires fixed-overhead calibration");
    }
    const invocation = createCanonicalCapsuleMeasurementInvocation(artifact, model, options);
    const expectedTarget = {
        agent: "claude",
        model,
        provider: options.provider ?? "unspecified",
        settings: invocation.settings
    };
    if (canonicalJson(options.calibration.target) !== canonicalJson(expectedTarget)) {
        throw new Error("canonical Work Capsule calibration does not match the target");
    }
    const { envelope, startedAt, completedAt } = await executeTarget(invocation, options.runner ?? defaultProcessRunner, options.now ?? (() => new Date()), options.workingDirectory);
    const fullCallInputTokens = totalInputTokens(envelope.usage);
    const fixedOverheadInputTokens = options.calibration.input.exactInputTokens;
    const payloadTokens = fullCallInputTokens - fixedOverheadInputTokens;
    if (payloadTokens < 0) {
        throw new Error("canonical Work Capsule input tokens are lower than calibrated overhead");
    }
    return {
        schemaVersion: "2.0.0",
        fixtureId: artifact.fixtureId,
        mode: artifact.mode,
        purpose: "canonical-work-capsule-baseline",
        sourceFingerprint: artifact.sourceFingerprint,
        target: expectedTarget,
        input: {
            promptSha256: sha256(invocation.stdin),
            promptUtf8Bytes: Buffer.byteLength(invocation.stdin, "utf8"),
            fullCallInputTokens,
            fixedOverheadInputTokens,
            canonicalWorkCapsulePayload: {
                sha256: sha256(artifact.content),
                utf8Bytes: Buffer.byteLength(artifact.content, "utf8"),
                tokens: payloadTokens
            }
        },
        responseSha256: sha256(envelope.result ?? ""),
        invocation: { startedAt, completedAt }
    };
}
