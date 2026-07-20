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
}

export interface SourceReader {
  readonly agent: string;
  discover(): Promise<readonly SourceSession[]>;
  select(selection: SessionSelection): Promise<SourceSession>;
  events(session: SourceSession): AsyncIterable<CanonicalSourceEvent>;
}

export class SourceSelectionError extends Error {
  constructor(
    readonly code: "SESSION_NOT_FOUND" | "NO_SESSION_IN_WORKSPACE" | "AMBIGUOUS_SESSION" | "ACTIVE_SESSION",
    message: string,
    readonly candidates: readonly SourceSession[] = []
  ) {
    super(message);
    this.name = "SourceSelectionError";
  }
}

