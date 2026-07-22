import { createHash } from "node:crypto";
import { redactSensitive } from "../security/redact.js";
import { deriveNextAction } from "./derive-next-action.js";
import { validateWorkCapsule } from "./validate-capsule.js";
export class CapsuleBuildError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "CapsuleBuildError";
    }
}
function sha256(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
function fact(event, evidenceRef, inferred = false) {
    if (event.text === undefined || event.text.length === 0) {
        throw new CapsuleBuildError("EMPTY_FACT", `event ${event.id} has no fact text`);
    }
    return { text: event.text, evidenceRefs: [evidenceRef], inferred };
}
function commandText(event) {
    if (event.text === undefined) {
        return undefined;
    }
    try {
        const input = JSON.parse(event.text);
        const command = input.cmd ?? input.command;
        return typeof command === "string" && command.length > 0 ? command : event.text;
    }
    catch {
        return event.text;
    }
}
const failedPattern = /\b(?:fail(?:ed|s)?|rejected|reverted|does not|did not|still|hangs?|error)\b|失败|未通过|无效|排除|放弃|回滚|仍然|报错|错误/i;
const passedPattern = /\b(?:pass(?:ed|es)?|success|exit code 0)\b|通过|成功/i;
function validationStatus(text) {
    if (text === undefined) {
        return "unknown";
    }
    if (failedPattern.test(text)) {
        return "failed";
    }
    if (passedPattern.test(text)) {
        return "passed";
    }
    return "unknown";
}
function uniqueEventIds(events) {
    const ids = new Set();
    for (const event of events) {
        if (ids.has(event.id)) {
            throw new CapsuleBuildError("DUPLICATE_EVIDENCE_ID", `duplicate evidence id ${event.id}`);
        }
        ids.add(event.id);
    }
}
function inheritedEvidence(parent) {
    if (parent === undefined) {
        return [];
    }
    return parent.evidenceRefs.map((evidence) => ({ ...evidence }));
}
function lineage(session, capturedAt, evidenceFingerprint, parent) {
    const capsuleId = `capsule-${sha256(`${session.agent}:${session.id}:${evidenceFingerprint}`).slice(0, 24)}`;
    const hop = {
        sourceAgent: session.agent,
        sourceSessionId: session.id,
        createdAt: capturedAt
    };
    if (parent === undefined) {
        return { capsuleId, rootCapsuleId: capsuleId, hops: [hop] };
    }
    return {
        capsuleId,
        rootCapsuleId: parent.lineage.rootCapsuleId,
        parentCapsuleId: parent.lineage.capsuleId,
        hops: [...parent.lineage.hops, hop]
    };
}
function lossReceipt(losses, force) {
    const criticalLosses = losses.filter((loss) => loss.severity === "critical").length;
    return {
        canContinue: criticalLosses === 0 || force,
        forced: criticalLosses > 0 && force,
        criticalLosses,
        warnings: losses.filter((loss) => loss.severity === "warning").length,
        information: losses.filter((loss) => loss.severity === "info").length,
        losses
    };
}
export function buildWorkCapsule(session, events, workspaceEvidence, options = {}) {
    uniqueEventIds(events);
    const eventEvidenceIds = new Map(events.map((event) => [
        event.id,
        `event:${sha256(`${session.agent}:${session.id}:${event.id}`).slice(0, 24)}`
    ]));
    const eventEvidenceId = (event) => eventEvidenceIds.get(event.id);
    const userMessages = events.filter((event) => event.kind === "user-message" && event.text !== undefined);
    const assistantMessages = events.filter((event) => (event.kind === "assistant-message" || event.kind === "agent-checkpoint")
        && event.text !== undefined);
    const checkpointMessages = events.filter((event) => event.kind === "agent-checkpoint" && event.text !== undefined);
    const hasActiveCheckpoint = events.some((event) => event.kind === "agent-checkpoint");
    const currentUserMessage = userMessages.at(-1);
    const objective = userMessages[0];
    if (currentUserMessage === undefined || objective === undefined) {
        throw new CapsuleBuildError("CURRENT_USER_MESSAGE_MISSING", "A Work Capsule requires at least one complete user message");
    }
    const capturedAt = (options.now ?? (() => new Date()))().toISOString();
    const losses = [
        {
            code: "DETERMINISTIC_SEMANTIC_HEURISTIC",
            severity: "warning",
            description: "Semantic categories use event roles and conservative text heuristics.",
            affectedFields: ["constraints", "decisions", "failedAttempts", "completed", "pending", "nextAction"]
        },
        {
            code: "HIDDEN_AGENT_STATE_UNAVAILABLE",
            severity: "info",
            description: "Hidden reasoning, prompt caches, and native tool state are not transferable.",
            affectedFields: []
        }
    ];
    if (assistantMessages.length === 0) {
        losses.push({
            code: "ASSISTANT_STATE_MISSING",
            severity: "critical",
            description: "No complete assistant state was found in the source session.",
            affectedFields: ["decisions", "completed"]
        });
    }
    if (hasActiveCheckpoint) {
        losses.push({
            code: "SOURCE_AGENT_CHECKPOINT",
            severity: "warning",
            description: "The source agent supplied a complete checkpoint through stdin; its claims are explicit but not independently verified.",
            affectedFields: ["decisions", "completed", "pending"]
        }, {
            code: "NATIVE_PARTIAL_ASSISTANT_OUTPUT_EXCLUDED",
            severity: "info",
            description: "Only complete native events and the explicit checkpoint were transferred; partial native assistant output was excluded.",
            affectedFields: ["decisions", "completed"]
        });
    }
    if (options.sourceSnapshot?.changedDuringCapture === true) {
        losses.push({
            code: "APPEND_DURING_SOURCE_CAPTURE",
            severity: "info",
            description: "The native session appended during capture; the verified starting byte prefix is the snapshot of record.",
            affectedFields: []
        });
    }
    if (options.sourceSnapshot?.trailingFragmentIgnored === true) {
        losses.push({
            code: "TRAILING_SOURCE_FRAGMENT_IGNORED",
            severity: "info",
            description: "An incomplete trailing native event was excluded from evidence.",
            affectedFields: []
        });
    }
    const attachments = events.filter((event) => event.kind === "attachment");
    if (attachments.length > 0) {
        losses.push({
            code: "ATTACHMENTS_NOT_TRANSFERRED",
            severity: "warning",
            description: `${attachments.length} local attachment reference(s) require target capability checks.`,
            affectedFields: ["files"]
        });
    }
    const workspaceFingerprintValue = JSON.stringify({
        workspace: workspaceEvidence.workspace,
        files: workspaceEvidence.files
    });
    const workspaceEvidenceId = `workspace:${sha256(workspaceFingerprintValue).slice(0, 24)}`;
    const workspaceEvidenceRef = workspaceEvidence.workspace.git === undefined
        ? []
        : [{
                id: workspaceEvidenceId,
                kind: "git",
                locator: workspaceEvidence.workspace.primaryRoot,
                sha256: sha256(workspaceFingerprintValue)
            }];
    const instructionEvidenceRefs = workspaceEvidence.workspace.instructionFiles.map((instruction) => ({
        id: `instruction:${instruction.sha256.slice(0, 24)}`,
        kind: "instruction",
        locator: instruction.path,
        sha256: instruction.sha256
    }));
    const currentEvidenceRefs = events.map((event) => ({
        id: eventEvidenceId(event),
        kind: event.kind === "agent-checkpoint" ? "checkpoint" : "session-event",
        locator: event.locator,
        sha256: sha256(JSON.stringify(event))
    }));
    const sourceSnapshotEvidenceRef = options.sourceSnapshot === undefined
        ? []
        : [{
                id: `snapshot:${sha256(`${session.agent}:${session.id}:${options.sourceSnapshot.sha256}`).slice(0, 24)}`,
                kind: "session-snapshot",
                locator: session.path,
                sha256: options.sourceSnapshot.sha256
            }];
    const evidenceRefs = [
        ...inheritedEvidence(options.parentCapsule),
        ...sourceSnapshotEvidenceRef,
        ...currentEvidenceRefs,
        ...workspaceEvidenceRef,
        ...instructionEvidenceRefs
    ].filter((evidence, index, all) => all.findIndex((candidate) => candidate.id === evidence.id) === index);
    const evidenceFingerprint = sha256(JSON.stringify(evidenceRefs));
    const nextAction = deriveNextAction(events);
    const actionFact = (value) => ({
        text: value.text,
        evidenceRefs: value.sourceEventIds.map((id) => eventEvidenceIds.get(id)),
        inferred: value.inferred
    });
    const rawCapsule = {
        schemaVersion: "2.0.0",
        source: {
            agent: session.agent,
            ...(session.agentVersion === null ? {} : { agentVersion: session.agentVersion }),
            sessionId: session.id,
            sessionLocator: session.path,
            capturedAt,
            ...(options.sourceSnapshot === undefined ? {} : { snapshot: options.sourceSnapshot })
        },
        workspace: workspaceEvidence.workspace,
        currentUserMessage: fact(currentUserMessage, eventEvidenceId(currentUserMessage)),
        objective: fact(objective, eventEvidenceId(objective)),
        constraints: userMessages.map((event) => fact(event, eventEvidenceId(event))),
        decisions: assistantMessages.map((event) => fact(event, eventEvidenceId(event))),
        failedAttempts: events
            .filter((event) => event.text !== undefined && failedPattern.test(event.text))
            .map((event) => ({
            attempt: event.text,
            outcome: "The source marks this path as failed, rejected, reverted, or unresolved.",
            evidenceRefs: [eventEvidenceId(event)],
            inferred: true
        })),
        completed: assistantMessages.map((event) => fact(event, eventEvidenceId(event))),
        pending: [
            fact(currentUserMessage, eventEvidenceId(currentUserMessage)),
            ...checkpointMessages.map((event) => fact(event, eventEvidenceId(event)))
        ],
        nextAction: {
            first: actionFact(nextAction.first),
            then: nextAction.then.map(actionFact),
            forbiddenBefore: nextAction.forbiddenBefore.map(actionFact)
        },
        files: [
            ...workspaceEvidence.files.map((file) => ({
                ...file,
                evidenceRefs: workspaceEvidence.workspace.git === undefined ? [] : [workspaceEvidenceId]
            })),
            ...attachments.map((event) => ({
                path: event.attachmentPath ?? "unavailable-attachment",
                kind: "attachment",
                availableToTarget: false,
                evidenceRefs: [eventEvidenceId(event)]
            }))
        ],
        commands: events
            .filter((event) => event.kind === "tool-call")
            .map((event) => ({ event, command: commandText(event) }))
            .filter((entry) => entry.command !== undefined)
            .map(({ event, command }) => ({
            command,
            cwd: workspaceEvidence.workspace.primaryRoot,
            ...(event.timestamp === null ? {} : { executedAt: event.timestamp }),
            evidenceRefs: [eventEvidenceId(event)]
        })),
        validations: events
            .filter((event) => event.kind === "tool-result")
            .map((event) => ({
            name: event.toolName ?? `Source tool result ${event.callId ?? event.id}`,
            status: validationStatus(event.text),
            summary: event.text ?? "Tool result content unavailable",
            ...(event.timestamp === null ? {} : { executedAt: event.timestamp }),
            evidenceRefs: [eventEvidenceId(event)]
        })),
        openQuestions: events
            .filter((event) => event.text?.trim().match(/[?？]$/) !== null && event.text !== undefined)
            .map((event) => fact(event, eventEvidenceId(event), true)),
        evidenceRefs,
        losses,
        lineage: lineage(session, capturedAt, evidenceFingerprint, options.parentCapsule)
    };
    const redaction = redactSensitive(rawCapsule, options.allowSensitive === true);
    if (redaction.findings.length > 0) {
        losses.push({
            code: options.allowSensitive === true ? "SENSITIVE_VALUES_ALLOWED" : "SENSITIVE_VALUES_REDACTED",
            severity: "warning",
            description: options.allowSensitive === true
                ? "Sensitive values were included by an explicit one-shot override."
                : "Sensitive values were redacted before rendering or target launch.",
            affectedFields: [...new Set(redaction.findings.map((finding) => finding.location))]
        });
    }
    const capsule = {
        ...redaction.value,
        losses: [...losses]
    };
    const schemaErrors = validateWorkCapsule(capsule);
    if (schemaErrors.length > 0) {
        const summary = schemaErrors
            .map((error) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`)
            .join("; ");
        throw new CapsuleBuildError("CAPSULE_SCHEMA_INVALID", summary);
    }
    const receipt = lossReceipt(losses, options.force === true);
    return { capsule, receipt };
}
