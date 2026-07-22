import { createHash } from "node:crypto";
import { deriveNextAction } from "../capsule/derive-next-action.js";
function canonicalize(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => [key, canonicalize(nested)]));
    }
    return value;
}
export function canonicalJson(value) {
    return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}
function sha256(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
export function sourceFingerprint(fixture) {
    return sha256(canonicalJson({ source: fixture.source, workspace: fixture.workspace }));
}
function fact(event) {
    return { text: event.text, evidenceRefs: [event.id], inferred: false };
}
function actionFact(value) {
    return { text: value.text, evidenceRefs: value.sourceEventIds, inferred: value.inferred };
}
function measurements(content) {
    return {
        utf8Bytes: Buffer.byteLength(content, "utf8"),
        unicodeCodePoints: [...content].length,
        exactTargetInputTokens: null
    };
}
function artifact(fixture, mode, contentType, content, generation) {
    return {
        schemaVersion: "1.0.0",
        fixtureId: fixture.id,
        mode,
        sourceFingerprint: sourceFingerprint(fixture),
        contentType,
        content,
        measurements: measurements(content),
        generation
    };
}
export function buildVisibleTranscript(fixture) {
    const content = fixture.source.events
        .filter((event) => event.kind === "user-message" || event.kind === "assistant-message")
        .map((event) => `## ${event.kind === "user-message" ? "User" : "Assistant"}\n\n${event.text}`)
        .join("\n\n");
    return artifact(fixture, "visible-transcript", "text/markdown", `${content}\n`, {
        deterministic: true,
        model: null,
        promptSha256: null,
        tools: "not-applicable",
        persistence: "not-applicable",
        summarizerInputTokens: null
    });
}
const failedAttemptPattern = /\b(?:fail(?:ed|s)?|rejected|reverted|does not|did not|still|hangs?)\b/i;
export function buildDeterministicCapsule(fixture) {
    const userEvents = fixture.source.events.filter((event) => event.kind === "user-message");
    const assistantEvents = fixture.source.events.filter((event) => event.kind === "assistant-message");
    const toolResults = fixture.source.events.filter((event) => event.kind === "tool-result");
    const currentUserMessage = userEvents.at(-1);
    const objective = userEvents[0];
    if (currentUserMessage === undefined || objective === undefined) {
        throw new Error(`fixture ${fixture.id} needs at least one user message`);
    }
    const capsuleId = `capsule-${sourceFingerprint(fixture).slice(0, 24)}`;
    const nextAction = deriveNextAction(fixture.source.events);
    const capsule = {
        schemaVersion: "2.0.0",
        source: {
            agent: fixture.source.agent,
            agentVersion: fixture.source.agentVersion,
            sessionId: fixture.id,
            sessionLocator: `benchmark/fixtures/${fixture.id}`,
            capturedAt: fixture.sanitization.checkedAt
        },
        workspace: {
            primaryRoot: fixture.workspace.root,
            additionalRoots: [],
            capturedAt: fixture.sanitization.checkedAt,
            git: {
                repoRoot: fixture.workspace.root,
                branch: fixture.workspace.git.branch,
                head: fixture.workspace.git.head,
                dirty: fixture.workspace.git.dirty
            }
        },
        currentUserMessage: fact(currentUserMessage),
        objective: fact(objective),
        constraints: userEvents.map(fact),
        decisions: assistantEvents.map(fact),
        failedAttempts: fixture.source.events
            .filter((event) => failedAttemptPattern.test(event.text))
            .map((event) => ({
            attempt: event.text,
            outcome: "The source event marks this path as failed, rejected, reverted, or unresolved.",
            evidenceRefs: [event.id],
            inferred: true
        })),
        completed: assistantEvents.map(fact),
        pending: [fact(currentUserMessage)],
        nextAction: {
            first: actionFact(nextAction.first),
            then: nextAction.then.map(actionFact),
            forbiddenBefore: nextAction.forbiddenBefore.map(actionFact)
        },
        files: fixture.workspace.files.map((file) => ({
            path: file.path,
            kind: file.state === "unchanged" ? "referenced" : file.state,
            ...(file.sha256 === undefined ? {} : { sha256: file.sha256 }),
            availableToTarget: true,
            evidenceRefs: []
        })),
        commands: [],
        validations: toolResults.map((event) => ({
            name: `Source tool result ${event.id}`,
            status: "unknown",
            summary: event.text,
            evidenceRefs: [event.id]
        })),
        openQuestions: [],
        evidenceRefs: fixture.source.events.map((event) => ({
            id: event.id,
            kind: "session-event",
            locator: `fixture:${fixture.id}/events/${event.id}`,
            sha256: sha256(canonicalJson(event))
        })),
        losses: [
            {
                code: "DETERMINISTIC_SEMANTIC_HEURISTIC",
                severity: "warning",
                description: "Semantic categories were populated by deterministic event-role and text heuristics.",
                affectedFields: ["constraints", "decisions", "failedAttempts", "completed", "pending", "nextAction"]
            },
            {
                code: "HIDDEN_AGENT_STATE_UNAVAILABLE",
                severity: "info",
                description: "Hidden reasoning, prompt caches, and native tool state are not present in the fixture.",
                affectedFields: []
            }
        ],
        lineage: {
            capsuleId,
            rootCapsuleId: capsuleId,
            hops: [
                {
                    sourceAgent: fixture.source.agent,
                    sourceSessionId: fixture.id,
                    createdAt: fixture.sanitization.checkedAt
                }
            ]
        }
    };
    const content = canonicalJson(capsule);
    return artifact(fixture, "deterministic-capsule", "application/json", content, {
        deterministic: true,
        model: null,
        promptSha256: null,
        tools: "not-applicable",
        persistence: "not-applicable",
        summarizerInputTokens: null
    });
}
export function buildSourceAssistedPrompt(fixture) {
    const source = canonicalJson({ source: fixture.source, workspace: fixture.workspace });
    return `Build one Work Capsule from the source events and current workspace below.

Rules:
- Use only the supplied source and workspace. Do not use or infer benchmark ground truth.
- Preserve the latest user message verbatim in currentUserMessage.text.
- Every task-specific fact must cite supplied event IDs, or set inferred to true.
- Distinguish completed work, pending work, decisions, and failed attempts.
- Set nextAction.first to the single action the target must do first, with source evidence.
- Put only actions that follow it in nextAction.then. Do not promote nextAction.then before nextAction.first is complete.
- Record explicitly blocked early actions in nextAction.forbiddenBefore; leave the array empty when the source establishes none.
- Current workspace facts override older transcript claims.
- Do not invent commands, validations, files, session state, or test results.
- Report hidden reasoning, prompt caches, tool state, and unavailable attachments as losses.
- Return only JSON conforming to the supplied Work Capsule schema.

SOURCE
${source}`;
}
export function sourceAssistedArtifact(fixture, model, capsule, summarizerInputTokens, prompt) {
    const content = canonicalJson(capsule);
    return artifact(fixture, "source-assisted-capsule", "application/json", content, {
        deterministic: false,
        model,
        promptSha256: sha256(prompt),
        tools: "disabled",
        persistence: "disabled",
        summarizerInputTokens
    });
}
export function recordExactTargetInputTokens(artifact, inputTokens) {
    if (!Number.isInteger(inputTokens) || inputTokens < 0) {
        throw new Error("target input tokens must be a non-negative integer");
    }
    return {
        ...artifact,
        measurements: {
            ...artifact.measurements,
            exactTargetInputTokens: inputTokens
        }
    };
}
