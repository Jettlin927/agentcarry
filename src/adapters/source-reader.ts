export type SessionActivity = "active" | "idle" | "unknown";
export type SessionKind = "main" | "subagent" | "automation" | "unknown";

export interface SourceSession {
  readonly agent: string;
  readonly id: string;
  readonly path: string;
  readonly cwd: string;
  readonly agentVersion: string | null;
  readonly modifiedAt: string;
  readonly kind: SessionKind;
  readonly activity: SessionActivity;
  readonly hasMessages: boolean;
}

export type CanonicalEventKind =
  | "user-message"
  | "assistant-message"
  | "agent-checkpoint"
  | "tool-call"
  | "tool-result"
  | "task-started"
  | "task-completed"
  | "attachment";

export interface CanonicalSourceEvent {
  readonly id: string;
  readonly kind: CanonicalEventKind;
  readonly timestamp: string | null;
  readonly locator: string;
  readonly text?: string;
  readonly toolName?: string;
  readonly callId?: string;
  readonly attachmentPath?: string;
}

export interface SessionSelection {
  readonly currentSessionId?: string;
  readonly explicitSessionId?: string;
  readonly cwd: string;
  readonly activity?: "idle" | "active";
}

export interface SourceSnapshot {
  readonly capturedAt: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly changedDuringCapture: boolean;
  readonly trailingFragmentIgnored: boolean;
}

export interface CapturedSource {
  readonly events: readonly CanonicalSourceEvent[];
  readonly snapshot: SourceSnapshot;
}

export interface SourceReader {
  readonly agent: string;
  discover(): Promise<readonly SourceSession[]>;
  select(selection: SessionSelection): Promise<SourceSession>;
  capture(session: SourceSession): Promise<CapturedSource>;
}

export class SourceSelectionError extends Error {
  constructor(
    readonly code: "SESSION_NOT_FOUND" | "NO_SESSION_IN_WORKSPACE" | "AMBIGUOUS_SESSION" | "ACTIVE_SESSION" | "SESSION_ACTIVITY_MISMATCH",
    message: string,
    readonly candidates: readonly SourceSession[] = []
  ) {
    super(message);
    this.name = "SourceSelectionError";
  }
}

export class SourceCaptureError extends Error {
  constructor(
    readonly code: "UNSTABLE_SOURCE_SNAPSHOT",
    message: string
  ) {
    super(message);
    this.name = "SourceCaptureError";
  }
}

