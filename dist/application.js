import { ClaudeTargetLauncher, TargetLaunchError } from "./adapters/claude/target-launcher.js";
import { CodexSourceReader } from "./adapters/codex/source-reader.js";
import { SourceCaptureError, SourceSelectionError } from "./adapters/source-reader.js";
import { CapsuleBuildError, buildWorkCapsule } from "./capsule/build-capsule.js";
import { ActiveCheckpointError, attachActiveCheckpoint } from "./checkpoint/active-checkpoint.js";
import { ExitCode } from "./cli.js";
import { collectWorkspaceEvidence } from "./workspace/collect-workspace.js";
import { diagnoseDoctor, renderDoctorReport } from "./diagnostics/doctor.js";
function failure(exitCode, code, message, details) {
    return {
        ok: false,
        exitCode,
        code,
        message,
        ...(details === undefined ? {} : { details })
    };
}
function preparationFailure(error) {
    if (error instanceof SourceSelectionError) {
        return failure(ExitCode.source, error.code, error.message, {
            candidates: error.candidates.map(({ id, modifiedAt, activity }) => ({ id, modifiedAt, activity }))
        });
    }
    if (error instanceof CapsuleBuildError) {
        return failure(ExitCode.source, error.code, error.message);
    }
    if (error instanceof ActiveCheckpointError || error instanceof SourceCaptureError) {
        return failure(ExitCode.source, error.code, error.message);
    }
    return failure(ExitCode.source, "SOURCE_PREPARATION_FAILED", error instanceof Error ? error.message : String(error));
}
function isPreparedTargetLaunch(value) {
    if (value === null || typeof value !== "object")
        return false;
    const prepared = value;
    return prepared.agent === "claude"
        && typeof prepared.targetSessionId === "string"
        && typeof prepared.prompt === "string"
        && Array.isArray(prepared.steps)
        && prepared.capsule !== undefined;
}
function renderLaunchPreview(prepared) {
    const sourceAgent = String(prepared.capsule.source.agent ?? "unknown");
    const sourceSession = String(prepared.capsule.source.sessionId ?? "unknown");
    const losses = prepared.lossReceipt.losses.length === 0
        ? "  none"
        : prepared.lossReceipt.losses.map((loss) => `  - ${loss.severity.toUpperCase()} ${loss.code}: ${loss.description}`).join("\n");
    const commands = prepared.steps.map((step, index) => `  ${index + 1}. ${step.displayCommand}`).join("\n");
    return `AgentCarry handoff ready

${sourceAgent === "codex" ? "Codex" : sourceAgent} session: ${sourceSession}
Target session: ${prepared.agent} ${prepared.targetSessionId}
Workspace: ${prepared.capsule.workspace.primaryRoot}
First action: ${prepared.capsule.nextAction.first.text}

Loss receipt: ${prepared.lossReceipt.criticalLosses} critical, ${prepared.lossReceipt.warnings} warning, ${prepared.lossReceipt.information} info
${losses}

Target commands:
${commands}

Source session: read-only; AgentCarry will not install agents or manage authentication.`;
}
export function createAgentCarryHandlers(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const codexReader = options.codexReader ?? new CodexSourceReader();
    const collectWorkspace = options.collectWorkspace ?? collectWorkspaceEvidence;
    const createClaudeLauncher = options.createClaudeLauncher
        ?? ((targetCwd) => new ClaudeTargetLauncher({ cwd: targetCwd }));
    return {
        async inspect() {
            return failure(ExitCode.source, "INSPECT_NOT_IMPLEMENTED", "Inspect will be connected after the first continuation tracer bullet.");
        },
        async prepareContinue(continueOptions) {
            const source = continueOptions.source ?? "codex";
            if (source !== "codex") {
                return failure(ExitCode.source, "UNSUPPORTED_SOURCE", `source agent ${source} is not supported yet`);
            }
            if (continueOptions.target !== "claude") {
                return failure(ExitCode.target, "UNSUPPORTED_TARGET", `target agent ${continueOptions.target} is not supported yet`);
            }
            try {
                const session = await codexReader.select({
                    cwd,
                    activity: continueOptions.active === true ? "active" : "idle",
                    ...(continueOptions.session === undefined
                        ? {}
                        : { explicitSessionId: continueOptions.session })
                });
                const [nativeCapture, workspace] = await Promise.all([
                    codexReader.capture(session),
                    collectWorkspace(session.cwd)
                ]);
                let capture = nativeCapture;
                if (continueOptions.active === true) {
                    if (continueOptions.checkpointStdin === undefined) {
                        return failure(ExitCode.usage, "CHECKPOINT_STDIN_REQUIRED", "active handoff requires a structured checkpoint on stdin");
                    }
                    continueOptions.checkpointStdin.ready();
                    capture = attachActiveCheckpoint(session, nativeCapture, await continueOptions.checkpointStdin.read());
                }
                const result = buildWorkCapsule(session, capture.events, workspace, {
                    force: continueOptions.force,
                    sourceSnapshot: capture.snapshot
                });
                if (!result.receipt.canContinue) {
                    return failure(ExitCode.criticalLoss, "CRITICAL_TRANSFER_LOSS", "Critical transfer loss stopped the handoff; review the loss receipt or retry once with --force.", { capsule: result.capsule, lossReceipt: result.receipt });
                }
                const prepared = createClaudeLauncher(workspace.workspace.primaryRoot).prepare(result);
                return { ok: true, data: prepared, human: renderLaunchPreview(prepared) };
            }
            catch (error) {
                return preparationFailure(error);
            }
        },
        async launchContinue(continueOptions, preparedResult) {
            if (continueOptions.target !== "claude" || !isPreparedTargetLaunch(preparedResult.data)) {
                return failure(ExitCode.target, "TARGET_LAUNCH_PLAN_INVALID", "The prepared target launch is invalid or does not match Claude Code.");
            }
            const prepared = preparedResult.data;
            const targetCwd = prepared.capsule.workspace.primaryRoot;
            if (typeof targetCwd !== "string" || targetCwd.length === 0) {
                return failure(ExitCode.target, "TARGET_LAUNCH_PLAN_INVALID", "The prepared target launch has no workspace root.");
            }
            try {
                const launched = await createClaudeLauncher(targetCwd).launch(prepared);
                return {
                    ok: true,
                    data: launched,
                    human: "Claude Code session ended normally."
                };
            }
            catch (error) {
                if (error instanceof TargetLaunchError) {
                    return failure(ExitCode.target, error.code, error.message, {
                        step: error.step,
                        ...(error.exitCode === undefined ? {} : { exitCode: error.exitCode })
                    });
                }
                return failure(ExitCode.target, "TARGET_LAUNCH_FAILED", "Claude Code could not be launched.");
            }
        },
        async doctor() {
            const report = options.diagnose === undefined
                ? await diagnoseDoctor({
                    codexReader,
                    diagnoseClaude: async () => await createClaudeLauncher(cwd).diagnose()
                })
                : await options.diagnose();
            return {
                ok: true,
                data: report,
                human: renderDoctorReport(report)
            };
        }
    };
}
