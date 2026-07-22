import { createHash } from "node:crypto";

export type HandoffMode =
  | "visible-transcript"
  | "deterministic-capsule"
  | "source-assisted-capsule";

export interface BenchmarkEvent {
  readonly id: string;
  readonly kind: "user-message" | "assistant-message" | "tool-call" | "tool-result" | "context";
  readonly text: string;
}

export interface BenchmarkSourceFixture {
  readonly id: string;
  readonly source: {
    readonly agent: string;
    readonly agentVersion: string;
    readonly events: readonly BenchmarkEvent[];
  };
  readonly workspace: {
    readonly root: string;
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly state: "modified" | "created" | "deleted" | "unchanged";
      readonly sha256?: string;
    }>;
    readonly git: {
      readonly branch: string;
      readonly head: string;
      readonly dirty: boolean;
    };
  };
  readonly sanitization: {
    readonly checkedAt: string;
  };
}

export interface HandoffInputArtifact {
  readonly schemaVersion: "1.0.0";
  readonly fixtureId: string;
  readonly mode: HandoffMode;
  readonly sourceFingerprint: string;
  readonly contentType: "text/markdown" | "application/json";
  readonly content: string;
  readonly measurements: {
    readonly utf8Bytes: number;
    readonly unicodeCodePoints: number;
    readonly exactTargetInputTokens: number | null;
  };
  readonly generation: {
    readonly deterministic: boolean;
    readonly model: string | null;
    readonly promptSha256: string | null;
    readonly tools: "disabled" | "not-applicable";
    readonly persistence: "disabled" | "not-applicable";
    readonly summarizerInputTokens: number | null;
  };
}

interface CapsuleFact {
  readonly text: string;
  readonly evidenceRefs: readonly string[];
  readonly inferred: boolean;
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

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sourceFingerprint(fixture: BenchmarkSourceFixture): string {
  return sha256(canonicalJson({ source: fixture.source, workspace: fixture.workspace }));
}

function fact(event: BenchmarkEvent): CapsuleFact {
  return { text: event.text, evidenceRefs: [event.id], inferred: false };
}

function nextActionFact(events: readonly BenchmarkEvent[]): CapsuleFact {
  let latestUserIndex = -1;
  let latestAssistantIndex = -1;
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]!.kind === "user-message") {
      latestUserIndex = index;
    }
    if (events[index]!.kind === "assistant-message") {
      latestAssistantIndex = index;
    }
  }
  let unresolvedEvent: BenchmarkEvent | undefined;
  if (latestAssistantIndex > latestUserIndex) {
    for (let index = events.length - 1; index > latestAssistantIndex; index -= 1) {
      if (events[index]!.kind === "tool-result") {
        unresolvedEvent = events[index];
        break;
      }
    }
  }
  const event = unresolvedEvent ?? events[latestUserIndex];
  if (event === undefined) {
    throw new Error("a deterministic capsule needs evidence for the next action");
  }
  return {
    text: event.text,
    evidenceRefs: [event.id],
    inferred: unresolvedEvent !== undefined
  };
}

function measurements(content: string): HandoffInputArtifact["measurements"] {
  return {
    utf8Bytes: Buffer.byteLength(content, "utf8"),
    unicodeCodePoints: [...content].length,
    exactTargetInputTokens: null
  };
}

function artifact(
  fixture: BenchmarkSourceFixture,
  mode: HandoffMode,
  contentType: HandoffInputArtifact["contentType"],
  content: string,
  generation: HandoffInputArtifact["generation"]
): HandoffInputArtifact {
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

export function buildVisibleTranscript(fixture: BenchmarkSourceFixture): HandoffInputArtifact {
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

export function buildDeterministicCapsule(
  fixture: BenchmarkSourceFixture
): HandoffInputArtifact {
  const userEvents = fixture.source.events.filter((event) => event.kind === "user-message");
  const assistantEvents = fixture.source.events.filter((event) => event.kind === "assistant-message");
  const toolResults = fixture.source.events.filter((event) => event.kind === "tool-result");
  const currentUserMessage = userEvents.at(-1);
  const objective = userEvents[0];
  if (currentUserMessage === undefined || objective === undefined) {
    throw new Error(`fixture ${fixture.id} needs at least one user message`);
  }

  const capsuleId = `capsule-${sourceFingerprint(fixture).slice(0, 24)}`;
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
      first: nextActionFact(fixture.source.events),
      then: [],
      forbiddenBefore: []
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

export function buildSourceAssistedPrompt(fixture: BenchmarkSourceFixture): string {
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

export function sourceAssistedArtifact(
  fixture: BenchmarkSourceFixture,
  model: string,
  capsule: unknown,
  summarizerInputTokens: number
): HandoffInputArtifact {
  const prompt = buildSourceAssistedPrompt(fixture);
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

export function recordExactTargetInputTokens(
  artifact: HandoffInputArtifact,
  inputTokens: number
): HandoffInputArtifact {
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
