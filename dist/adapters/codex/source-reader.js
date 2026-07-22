import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, opendir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { SourceCaptureError, SourceSelectionError } from "../source-reader.js";
export const codexAdapterMetadata = {
    agent: "codex",
    adapterVersion: "0.1.0",
    accessTier: "private-local-storage",
    observedCodexVersions: ["0.145.0-alpha.18"],
    storage: "~/.codex/sessions/**/*.jsonl",
    sourceMutation: "never"
};
export function resolveCodexSessionRoot(options = {}) {
    if (options.sessionRoot !== undefined) {
        return resolve(options.sessionRoot);
    }
    const home = options.codexHome
        ?? process.env.CODEX_HOME
        ?? join(options.userHome ?? homedir(), ".codex");
    return resolve(home, "sessions");
}
async function* filesRecursively(directory) {
    const handle = await opendir(directory);
    for await (const entry of handle) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* filesRecursively(path);
        }
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            yield path;
        }
    }
}
async function* completeLines(path) {
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
        }
        catch {
            // A live JSONL file can end halfway through the next event. The trailing
            // fragment is not evidence until it becomes valid JSON.
        }
    }
}
async function scanSnapshotPrefix(path, byteLength) {
    const hash = createHash("sha256");
    const decoder = new StringDecoder("utf8");
    const events = [];
    let pending = "";
    let lineNumber = 0;
    let bytesRead = 0;
    if (byteLength > 0) {
        const stream = createReadStream(path, { start: 0, end: byteLength - 1 });
        for await (const chunk of stream) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytesRead += buffer.length;
            hash.update(buffer);
            pending += decoder.write(buffer);
            let newline = pending.indexOf("\n");
            while (newline !== -1) {
                lineNumber += 1;
                const line = pending.slice(0, newline).replace(/\r$/, "");
                pending = pending.slice(newline + 1);
                if (line.length > 0) {
                    events.push(...canonicalEvents(path, lineNumber, parseEnvelope(line)));
                }
                newline = pending.indexOf("\n");
            }
        }
    }
    pending += decoder.end();
    const trailing = pending.replace(/\r$/, "");
    if (trailing.length === 0) {
        return { events, sha256: hash.digest("hex"), bytesRead, trailingFragmentIgnored: false };
    }
    try {
        lineNumber += 1;
        events.push(...canonicalEvents(path, lineNumber, parseEnvelope(trailing)));
        return { events, sha256: hash.digest("hex"), bytesRead, trailingFragmentIgnored: false };
    }
    catch {
        return { events, sha256: hash.digest("hex"), bytesRead, trailingFragmentIgnored: true };
    }
}
async function hashPrefix(path, byteLength) {
    const hash = createHash("sha256");
    let bytesRead = 0;
    if (byteLength > 0) {
        const stream = createReadStream(path, { start: 0, end: byteLength - 1 });
        for await (const chunk of stream) {
            const buffer = chunk;
            bytesRead += buffer.length;
            hash.update(buffer);
        }
    }
    return { sha256: hash.digest("hex"), bytesRead };
}
async function firstCompleteLine(path) {
    for await (const entry of completeLines(path)) {
        return entry.line;
    }
    return undefined;
}
function parseEnvelope(line) {
    return JSON.parse(line);
}
function sessionKind(meta) {
    if (meta.thread_source === "subagent") {
        return "subagent";
    }
    if (meta.thread_source === "automation") {
        return "automation";
    }
    if (meta.thread_source === "user" || meta.source === "vscode") {
        return "main";
    }
    if (meta.source !== null
        && typeof meta.source === "object"
        && "subagent" in meta.source) {
        return "subagent";
    }
    return "unknown";
}
async function tailActivity(path) {
    const metadata = await stat(path);
    if (metadata.size === 0) {
        return "unknown";
    }
    const handle = await open(path, "r");
    try {
        let bytesToRead = Math.min(metadata.size, 256 * 1024);
        while (true) {
            const start = metadata.size - bytesToRead;
            const buffer = Buffer.alloc(bytesToRead);
            const { bytesRead } = await handle.read(buffer, 0, bytesToRead, start);
            const lines = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/);
            if (start > 0) {
                lines.shift();
            }
            for (let index = lines.length - 1; index >= 0; index -= 1) {
                const line = lines[index];
                if (line.length === 0) {
                    continue;
                }
                try {
                    const event = parseEnvelope(line);
                    const payloadType = event.payload?.type;
                    if (event.type === "event_msg" && payloadType === "task_started") {
                        return "active";
                    }
                    if (event.type === "event_msg" && payloadType === "task_complete") {
                        return "idle";
                    }
                }
                catch {
                    // A partial first/last line is not an activity marker.
                }
            }
            if (bytesToRead === metadata.size) {
                return "unknown";
            }
            bytesToRead = Math.min(metadata.size, bytesToRead * 4);
        }
    }
    finally {
        await handle.close();
    }
}
async function hasVisibleMessages(path) {
    for await (const entry of completeLines(path)) {
        const event = parseEnvelope(entry.line);
        if (event.type === "event_msg"
            && (event.payload?.type === "user_message" || event.payload?.type === "agent_message")) {
            return true;
        }
    }
    return false;
}
async function inspectSession(path) {
    const line = await firstCompleteLine(path);
    if (line === undefined) {
        return undefined;
    }
    const envelope = parseEnvelope(line);
    if (envelope.type !== "session_meta" || envelope.payload === undefined) {
        return undefined;
    }
    const meta = envelope.payload;
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
async function canonicalWorkspace(path) {
    try {
        return await realpath(path);
    }
    catch {
        return path;
    }
}
async function sameWorkspace(left, right) {
    const [canonicalLeft, canonicalRight] = await Promise.all([
        canonicalWorkspace(left),
        canonicalWorkspace(right)
    ]);
    const windowsPath = /^[A-Za-z]:[\\/]/;
    if (windowsPath.test(canonicalLeft) || windowsPath.test(canonicalRight)) {
        return win32.resolve(canonicalLeft).toLowerCase() === win32.resolve(canonicalRight).toLowerCase();
    }
    return resolve(canonicalLeft) === resolve(canonicalRight);
}
async function relatedWorkspace(left, right) {
    const [canonicalLeft, canonicalRight] = await Promise.all([
        canonicalWorkspace(left),
        canonicalWorkspace(right)
    ]);
    const windowsPath = /^[A-Za-z]:[\\/]/;
    if (windowsPath.test(canonicalLeft) || windowsPath.test(canonicalRight)) {
        const leftPath = win32.resolve(canonicalLeft).toLowerCase();
        const rightPath = win32.resolve(canonicalRight).toLowerCase();
        const candidates = [
            win32.relative(leftPath, rightPath),
            win32.relative(rightPath, leftPath)
        ];
        return candidates.some((candidate) => candidate === "" || (!candidate.startsWith("..") && !win32.isAbsolute(candidate)));
    }
    const leftPath = resolve(canonicalLeft);
    const rightPath = resolve(canonicalRight);
    const candidates = [relative(leftPath, rightPath), relative(rightPath, leftPath)];
    return candidates.some((candidate) => candidate === "" || (!candidate.startsWith("..") && !isAbsolute(candidate)));
}
function text(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function contentText(value) {
    const direct = text(value);
    if (direct !== undefined) {
        return direct;
    }
    if (value !== null && typeof value === "object") {
        return JSON.stringify(value);
    }
    return undefined;
}
function eventId(path, lineNumber, event) {
    const nativeId = text(event.payload?.id) ?? text(event.payload?.call_id);
    if (nativeId !== undefined) {
        return nativeId;
    }
    return createHash("sha256")
        .update(`${basename(path)}:${lineNumber}`)
        .digest("hex")
        .slice(0, 24);
}
function canonicalEvents(path, lineNumber, event) {
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
        const events = [];
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
export class CodexSourceReader {
    agent = "codex";
    #sessionRoot;
    constructor(options = {}) {
        this.#sessionRoot = resolveCodexSessionRoot(options);
    }
    async discover() {
        const sessions = [];
        try {
            for await (const path of filesRecursively(this.#sessionRoot)) {
                const session = await inspectSession(path);
                if (session !== undefined) {
                    sessions.push(session);
                }
            }
        }
        catch (error) {
            const code = error.code;
            if (code === "ENOENT") {
                return [];
            }
            throw error;
        }
        return sessions.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || left.id.localeCompare(right.id));
    }
    async select(selection) {
        const sessions = await this.discover();
        const requiredActivity = selection.activity ?? "idle";
        const requestedId = selection.currentSessionId ?? selection.explicitSessionId;
        if (requestedId !== undefined) {
            const selected = sessions.find((session) => session.id === requestedId);
            if (selected === undefined) {
                throw new SourceSelectionError("SESSION_NOT_FOUND", `Codex session ${requestedId} was not found`);
            }
            if (selected.kind !== "main" || !selected.hasMessages) {
                throw new SourceSelectionError("SESSION_NOT_FOUND", `Codex session ${requestedId} is not an eligible non-empty main session`);
            }
            if (selected.activity !== requiredActivity) {
                if (requiredActivity === "idle") {
                    throw new SourceSelectionError("ACTIVE_SESSION", `Codex session ${requestedId} is ${selected.activity}; only confirmed idle sessions can be transferred without an active checkpoint`, [selected]);
                }
                throw new SourceSelectionError("SESSION_ACTIVITY_MISMATCH", `Codex session ${requestedId} is ${selected.activity}; active checkpoint mode requires a confirmed active session`, [selected]);
            }
            return selected;
        }
        const workspaceMatches = await Promise.all(sessions.map(async (session) => session.kind === "main"
            && session.activity === requiredActivity
            && session.hasMessages
            && (requiredActivity === "active"
                ? await relatedWorkspace(session.cwd, selection.cwd)
                : await sameWorkspace(session.cwd, selection.cwd))));
        const candidates = sessions.filter((_session, index) => workspaceMatches[index]);
        if (candidates.length === 0) {
            throw new SourceSelectionError("NO_SESSION_IN_WORKSPACE", `No ${requiredActivity} main Codex session was found in ${selection.cwd}`);
        }
        if (requiredActivity === "active" && candidates.length > 1) {
            throw new SourceSelectionError("AMBIGUOUS_SESSION", "Multiple active Codex sessions exist in this workspace; select one explicitly", candidates);
        }
        const latest = candidates[0];
        const tied = candidates.filter((candidate) => candidate.modifiedAt === latest.modifiedAt);
        if (tied.length > 1) {
            throw new SourceSelectionError("AMBIGUOUS_SESSION", "Multiple Codex sessions have the same latest modification time", tied);
        }
        return latest;
    }
    async capture(session) {
        if (session.agent !== this.agent) {
            throw new Error(`CodexSourceReader cannot read ${session.agent} sessions`);
        }
        const before = await stat(session.path);
        const scanned = await scanSnapshotPrefix(session.path, before.size);
        const verified = await hashPrefix(session.path, before.size);
        if (scanned.bytesRead !== before.size
            || verified.bytesRead !== before.size
            || scanned.sha256 !== verified.sha256) {
            throw new SourceCaptureError("UNSTABLE_SOURCE_SNAPSHOT", "The source changed within the captured prefix; retry after the native writer reaches an append-only state");
        }
        const after = await stat(session.path);
        return {
            events: scanned.events,
            snapshot: {
                capturedAt: new Date().toISOString(),
                byteLength: before.size,
                sha256: scanned.sha256,
                changedDuringCapture: before.size !== after.size || before.mtimeMs !== after.mtimeMs,
                trailingFragmentIgnored: scanned.trailingFragmentIgnored
            }
        };
    }
}
