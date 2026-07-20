import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, win32 } from "node:path";
import {
  SourceSelectionError,
  type CanonicalSourceEvent,
  type SessionActivity,
  type SessionKind,
  type SessionSelection,
  type SourceReader,
  type SourceSession
} from "../source-reader.js";

interface CodexEnvelope {
  readonly timestamp?: string;
  readonly type?: string;
  readonly payload?: Record<string, unknown>;
}

interface CodexSessionMeta {
  readonly id?: unknown;
  readonly cwd?: unknown;
  readonly cli_version?: unknown;
  readonly source?: unknown;
  readonly thread_source?: unknown;
}

export interface CodexSourceReaderOptions {
  readonly sessionRoot?: string;
  readonly codexHome?: string;
  readonly userHome?: string;
}

export const codexAdapterMetadata = {
  agent: "codex",
  adapterVersion: "0.1.0",
  accessTier: "private-local-storage",
  observedCodexVersions: ["0.145.0-alpha.18"],
  storage: "~/.codex/sessions/**/*.jsonl",
  sourceMutation: "never"
} as const;

export function resolveCodexSessionRoot(options: CodexSourceReaderOptions = {}): string {
  if (options.sessionRoot !== undefined) {
    return resolve(options.sessionRoot);
  }
  const home = options.codexHome
    ?? process.env.CODEX_HOME
    ?? join(options.userHome ?? homedir(), ".codex");
  return resolve(home, "sessions");
}

async function* filesRecursively(directory: string): AsyncIterable<string> {
  const handle = await opendir(directory);
  for await (const entry of handle) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* filesRecursively(path);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield path;
    }
  }
}

async function* completeLines(path: string): AsyncIterable<{ line: string; lineNumber: number }> {
  const stream = createReadStream(path, { encoding: "utf8" });
  let pending = "";
  let lineNumber = 0;
  for await (const chunk of stream) {
    pending += chunk;
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      lineNumber += 1;
      const line = pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
      if (line.length > 0) {
        yield { line, lineNumber };
      }
      newline = pending.indexOf("\n");
    }
  }
  const trailing = pending.replace(/\r$/, "");
  if (trailing.length > 0) {
    try {
      JSON.parse(trailing);
      lineNumber += 1;
      yield { line: trailing, lineNumber };
    } catch {
      // A live JSONL file can end halfway through the next event. The trailing
      // fragment is not evidence until it becomes valid JSON.
    }
  }
}

async function firstCompleteLine(path: string): Promise<string | undefined> {
  for await (const entry of completeLines(path)) {
    return entry.line;
  }
  return undefined;
}

function parseEnvelope(line: string): CodexEnvelope {
  return JSON.parse(line) as CodexEnvelope;
}

function sessionKind(meta: CodexSessionMeta): SessionKind {
  if (meta.thread_source === "subagent") {
    return "subagent";
  }
  if (meta.thread_source === "automation") {
    return "automation";
  }
  if (meta.thread_source === "user" || meta.source === "vscode") {
    return "main";
  }
  if (
    meta.source !== null
    && typeof meta.source === "object"
    && "subagent" in meta.source
  ) {
    return "subagent";
  }
  return "unknown";
}

async function tailActivity(path: string): Promise<SessionActivity> {
  const metadata = await stat(path);
  const bytesToRead = Math.min(metadata.size, 256 * 1024);
  if (bytesToRead === 0) {
    return "unknown";
  }
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, metadata.size - bytesToRead);
    const lines = buffer.toString("utf8").split(/\r?\n/);
    if (metadata.size > bytesToRead) {
      lines.shift();
    }
    let state: SessionActivity = "unknown";
    for (const line of lines) {
      if (line.length === 0) {
        continue;
      }
      try {
        const event = parseEnvelope(line);
        const payloadType = event.payload?.type;
        if (event.type === "event_msg" && payloadType === "task_started") {
          state = "active";
        } else if (event.type === "event_msg" && payloadType === "task_complete") {
          state = "idle";
        }
      } catch {
        // A partial first/last tail line does not invalidate prior complete events.
      }
    }
    return state;
  } finally {
    await handle.close();
  }
}

async function hasVisibleMessages(path: string): Promise<boolean> {
  for await (const entry of completeLines(path)) {
    const event = parseEnvelope(entry.line);
    if (
      event.type === "event_msg"
      && (event.payload?.type === "user_message" || event.payload?.type === "agent_message")
    ) {
      return true;
    }
  }
  return false;
}

async function inspectSession(path: string): Promise<SourceSession | undefined> {
  const line = await firstCompleteLine(path);
  if (line === undefined) {
    return undefined;
  }
  const envelope = parseEnvelope(line);
  if (envelope.type !== "session_meta" || envelope.payload === undefined) {
    return undefined;
  }
  const meta = envelope.payload as CodexSessionMeta;
  if (typeof meta.id !== "string" || typeof meta.cwd !== "string") {
    return undefined;
  }
  const metadata = await stat(path);
  return {
    agent: "codex",
    id: meta.id,
    path,
    cwd: meta.cwd,
    agentVersion: typeof meta.cli_version === "string" ? meta.cli_version : null,
    modifiedAt: metadata.mtime.toISOString(),
    kind: sessionKind(meta),
    activity: await tailActivity(path),
    hasMessages: await hasVisibleMessages(path)
  };
}

function sameWorkspace(left: string, right: string): boolean {
  const windowsPath = /^[A-Za-z]:[\\/]/;
  if (windowsPath.test(left) || windowsPath.test(right)) {
    return win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
  }
  return resolve(left) === resolve(right);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function contentText(value: unknown): string | undefined {
  const direct = text(value);
  if (direct !== undefined) {
    return direct;
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify(value);
  }
  return undefined;
}

function eventId(path: string, lineNumber: number, event: CodexEnvelope): string {
  const nativeId = text(event.payload?.id) ?? text(event.payload?.call_id);
  if (nativeId !== undefined) {
    return nativeId;
  }
  return createHash("sha256")
    .update(`${basename(path)}:${lineNumber}`)
    .digest("hex")
    .slice(0, 24);
}

function canonicalEvents(
  path: string,
  lineNumber: number,
  event: CodexEnvelope
): CanonicalSourceEvent[] {
  const payload = event.payload;
  if (payload === undefined) {
    return [];
  }
  const locator = `${path}:${lineNumber}`;
  const base = {
    id: eventId(path, lineNumber, event),
    timestamp: text(event.timestamp) ?? null,
    locator
  };
  if (event.type === "event_msg" && payload.type === "user_message") {
    const events: CanonicalSourceEvent[] = [];
    const message = text(payload.message);
    if (message !== undefined) {
      events.push({ ...base, kind: "user-message", text: message });
    }
    const localImages = Array.isArray(payload.local_images) ? payload.local_images : [];
    localImages.forEach((image, index) => {
      const attachmentPath = text(image);
      if (attachmentPath !== undefined) {
        events.push({
          ...base,
          id: `${base.id}-attachment-${index + 1}`,
          kind: "attachment",
          attachmentPath
        });
      }
    });
    return events;
  }
  if (event.type === "event_msg" && payload.type === "agent_message") {
    const message = text(payload.message);
    return message === undefined ? [] : [{ ...base, kind: "assistant-message", text: message }];
  }
  if (event.type === "response_item" && payload.type === "custom_tool_call") {
    const toolName = text(payload.name);
    const callId = text(payload.call_id);
    const input = contentText(payload.input);
    return [{
      ...base,
      kind: "tool-call",
      ...(toolName === undefined ? {} : { toolName }),
      ...(callId === undefined ? {} : { callId }),
      ...(input === undefined ? {} : { text: input })
    }];
  }
  if (event.type === "response_item" && payload.type === "custom_tool_call_output") {
    const callId = text(payload.call_id);
    const output = contentText(payload.output);
    return [{
      ...base,
      kind: "tool-result",
      ...(callId === undefined ? {} : { callId }),
      ...(output === undefined ? {} : { text: output })
    }];
  }
  if (event.type === "event_msg" && payload.type === "task_started") {
    return [{ ...base, kind: "task-started" }];
  }
  if (event.type === "event_msg" && payload.type === "task_complete") {
    return [{ ...base, kind: "task-completed" }];
  }
  return [];
}

export class CodexSourceReader implements SourceReader {
  readonly agent = "codex";
  readonly #sessionRoot: string;

  constructor(options: CodexSourceReaderOptions = {}) {
    this.#sessionRoot = resolveCodexSessionRoot(options);
  }

  async discover(): Promise<readonly SourceSession[]> {
    const sessions: SourceSession[] = [];
    try {
      for await (const path of filesRecursively(this.#sessionRoot)) {
        const session = await inspectSession(path);
        if (session !== undefined) {
          sessions.push(session);
        }
      }
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return [];
      }
      throw error;
    }
    return sessions.sort((left, right) =>
      right.modifiedAt.localeCompare(left.modifiedAt) || left.id.localeCompare(right.id)
    );
  }

  async select(selection: SessionSelection): Promise<SourceSession> {
    const sessions = await this.discover();
    const requestedId = selection.currentSessionId ?? selection.explicitSessionId;
    if (requestedId !== undefined) {
      const selected = sessions.find((session) => session.id === requestedId);
      if (selected === undefined) {
        throw new SourceSelectionError(
          "SESSION_NOT_FOUND",
          `Codex session ${requestedId} was not found`
        );
      }
      if (selected.kind !== "main" || !selected.hasMessages) {
        throw new SourceSelectionError(
          "SESSION_NOT_FOUND",
          `Codex session ${requestedId} is not an eligible non-empty main session`
        );
      }
      if (selected.activity !== "idle") {
        throw new SourceSelectionError(
          "ACTIVE_SESSION",
          `Codex session ${requestedId} is ${selected.activity}; only confirmed idle sessions can be transferred safely`,
          [selected]
        );
      }
      return selected;
    }

    const candidates = sessions.filter((session) =>
      session.kind === "main"
      && session.activity === "idle"
      && session.hasMessages
      && sameWorkspace(session.cwd, selection.cwd)
    );
    if (candidates.length === 0) {
      throw new SourceSelectionError(
        "NO_SESSION_IN_WORKSPACE",
        `No idle main Codex session was found in ${selection.cwd}`
      );
    }
    const latest = candidates[0]!;
    const tied = candidates.filter((candidate) => candidate.modifiedAt === latest.modifiedAt);
    if (tied.length > 1) {
      throw new SourceSelectionError(
        "AMBIGUOUS_SESSION",
        "Multiple Codex sessions have the same latest modification time",
        tied
      );
    }
    return latest;
  }

  async *events(session: SourceSession): AsyncIterable<CanonicalSourceEvent> {
    if (session.agent !== this.agent) {
      throw new Error(`CodexSourceReader cannot read ${session.agent} sessions`);
    }
    for await (const entry of completeLines(session.path)) {
      const event = parseEnvelope(entry.line);
      yield* canonicalEvents(session.path, entry.lineNumber, event);
    }
  }
}
