import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CodexSourceReader } from "../src/adapters/codex/source-reader.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/codex/", import.meta.url));
const temporaryRoots: string[] = [];

async function testRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentcarry-codex-reader-"));
  temporaryRoots.push(root);
  await cp(fixtureRoot, root, { recursive: true });
  const old = new Date("2026-07-20T00:00:00Z");
  const latest = new Date("2026-07-21T00:00:00Z");
  await utimes(join(root, "main-older.jsonl"), old, old);
  await utimes(join(root, "main-idle.jsonl"), latest, latest);
  return root;
}

async function hash(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CodexSourceReader", () => {
  it("discovers versioned main, subagent, active, and idle sessions", async () => {
    const reader = new CodexSourceReader({ sessionRoot: await testRoot() });
    const sessions = await reader.discover();

    expect(sessions).toHaveLength(5);
    expect(sessions.find((session) => session.id === "session-subagent")?.kind).toBe("subagent");
    expect(sessions.find((session) => session.id === "session-main-active")?.activity).toBe("active");
    expect(sessions.find((session) => session.id === "session-main-idle")).toMatchObject({
      kind: "main",
      activity: "idle",
      agentVersion: "0.145.0-alpha.18",
      hasMessages: true
    });
    expect(sessions.find((session) => session.id === "session-empty")?.hasMessages).toBe(false);
  });

  it("selects the latest idle main session in a case-insensitive Windows cwd", async () => {
    const reader = new CodexSourceReader({ sessionRoot: await testRoot() });

    const selected = await reader.select({ cwd: "c:\\users\\dev\\中文 项目" });

    expect(selected.id).toBe("session-main-idle");
  });

  it("honors current session id before explicit session id", async () => {
    const reader = new CodexSourceReader({ sessionRoot: await testRoot() });

    const selected = await reader.select({
      cwd: "C:\\other",
      currentSessionId: "session-main-idle",
      explicitSessionId: "session-main-older"
    });

    expect(selected.id).toBe("session-main-idle");
  });

  it("blocks explicitly selected active sessions", async () => {
    const reader = new CodexSourceReader({ sessionRoot: await testRoot() });

    await expect(reader.select({
      cwd: "C:\\Users\\dev\\active",
      explicitSessionId: "session-main-active"
    })).rejects.toMatchObject({ code: "ACTIVE_SESSION" });
  });

  it("selects a unique active session only when active mode is explicit", async () => {
    const root = await testRoot();
    const reader = new CodexSourceReader({ sessionRoot: root });

    const selected = await reader.select({
      cwd: "C:\\Users\\dev\\active\\nested-repository",
      activity: "active"
    });

    expect(selected.id).toBe("session-main-active");
    await expect(reader.select({
      cwd: "C:\\Users\\dev\\中文 项目",
      activity: "active"
    })).rejects.toMatchObject({ code: "NO_SESSION_IN_WORKSPACE" });
  });

  it("expands the tail scan until it finds the latest activity marker", async () => {
    const root = await testRoot();
    const path = join(root, "long-active.jsonl");
    const padding = Array.from({ length: 1_500 }, (_, index) => ({
      timestamp: "2026-07-21T00:00:03Z",
      type: "event_msg",
      payload: { type: "agent_message", phase: "commentary", message: `Working ${index} ${"x".repeat(256)}` }
    }));
    const lines = [
      { timestamp: "2026-07-21T00:00:00Z", type: "session_meta", payload: { id: "session-long-active", cwd: "/tmp/agentcarry-long-active", cli_version: "test", source: "vscode", thread_source: "user" } },
      { timestamp: "2026-07-21T00:00:01Z", type: "event_msg", payload: { type: "task_started" } },
      { timestamp: "2026-07-21T00:00:02Z", type: "event_msg", payload: { type: "user_message", message: "Keep this long task active." } },
      ...padding
    ];
    await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
    const reader = new CodexSourceReader({ sessionRoot: root });

    const selected = await reader.select({
      cwd: "/tmp/agentcarry-long-active/child",
      activity: "active"
    });

    expect(selected).toMatchObject({ id: "session-long-active", activity: "active" });
  });

  it("captures an active session as a verified prefix without changing its bytes", async () => {
    const root = await testRoot();
    const path = join(root, "main-active.jsonl");
    const before = await hash(path);
    const reader = new CodexSourceReader({ sessionRoot: root });
    const session = await reader.select({
      cwd: "C:\\Users\\dev\\active",
      activity: "active"
    });

    const captured = await reader.capture(session);

    expect(captured.events.at(-1)).not.toMatchObject({ kind: "task-completed" });
    expect(captured.snapshot).toMatchObject({
      byteLength: (await stat(path)).size,
      sha256: before,
      changedDuringCapture: false
    });
    expect(await hash(path)).toBe(before);
  });

  it("rejects explicit subagent and empty session selections", async () => {
    const reader = new CodexSourceReader({ sessionRoot: await testRoot() });

    await expect(reader.select({
      cwd: "C:\\Users\\dev\\中文 项目",
      explicitSessionId: "session-subagent"
    })).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    await expect(reader.select({
      cwd: "C:\\Users\\dev\\中文 项目",
      explicitSessionId: "session-empty"
    })).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  it("returns candidates when the latest session is ambiguous", async () => {
    const root = await testRoot();
    const same = new Date("2026-07-21T00:00:00Z");
    await utimes(join(root, "main-older.jsonl"), same, same);
    const reader = new CodexSourceReader({ sessionRoot: root });

    try {
      await reader.select({ cwd: "C:\\Users\\dev\\中文 项目" });
      throw new Error("expected ambiguous selection");
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: "AMBIGUOUS_SESSION" });
      expect((error as { candidates: unknown[] }).candidates).toHaveLength(2);
    }
  });

  it("streams canonical visible messages, tool evidence, and attachments", async () => {
    const root = await testRoot();
    const reader = new CodexSourceReader({ sessionRoot: root });
    const session = await reader.select({ cwd: "C:\\Users\\dev\\中文 项目" });
    const events = (await reader.capture(session)).events;

    expect(events.map((event) => event.kind)).toEqual([
      "task-started",
      "user-message",
      "attachment",
      "tool-call",
      "tool-result",
      "assistant-message",
      "task-completed"
    ]);
    expect(events.find((event) => event.kind === "attachment")?.attachmentPath).toContain("error.png");
    expect(events.find((event) => event.kind === "tool-call")).toMatchObject({
      toolName: "exec_command",
      callId: "call-1"
    });
  });

  it("ignores a partial trailing live event and never mutates the source", async () => {
    const root = await testRoot();
    const path = join(root, "main-idle.jsonl");
    const { appendFile } = await import("node:fs/promises");
    await appendFile(path, '{"type":"event_msg","payload":', "utf8");
    const before = await hash(path);
    const sizeBefore = (await stat(path)).size;
    const reader = new CodexSourceReader({ sessionRoot: root });
    const session = (await reader.discover()).find((item) => item.id === "session-main-idle")!;
    const captured = await reader.capture(session);
    const events = captured.events;

    expect(events.length).toBeGreaterThan(0);
    expect(captured.snapshot.trailingFragmentIgnored).toBe(true);
    expect(await hash(path)).toBe(before);
    expect((await stat(path)).size).toBe(sizeBefore);
  });

  it("selects an exact WSL workspace path", async () => {
    const root = await testRoot();
    const path = join(root, "wsl-main.jsonl");
    const lines = [
      { timestamp: "2026-07-21T00:00:00Z", type: "session_meta", payload: { id: "session-wsl", cwd: "/mnt/c/Users/dev/agent carry", cli_version: "0.145.0-alpha.18", source: "vscode", thread_source: "user" } },
      { timestamp: "2026-07-21T00:00:01Z", type: "event_msg", payload: { type: "task_started" } },
      { timestamp: "2026-07-21T00:00:02Z", type: "event_msg", payload: { type: "user_message", message: "Continue from WSL." } },
      { timestamp: "2026-07-21T00:00:03Z", type: "event_msg", payload: { type: "agent_message", message: "Ready." } },
      { timestamp: "2026-07-21T00:00:04Z", type: "event_msg", payload: { type: "task_complete" } }
    ];
    await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
    const reader = new CodexSourceReader({ sessionRoot: root });

    const selected = await reader.select({ cwd: "/mnt/c/Users/dev/agent carry" });

    expect(selected.id).toBe("session-wsl");
  });

  it("streams a large completed JSONL without mutating it", async () => {
    const root = await testRoot();
    const path = join(root, "large-main.jsonl");
    const messages = Array.from({ length: 5_000 }, (_, index) => ({
      timestamp: "2026-07-21T00:00:03Z",
      type: "event_msg",
      payload: { type: "agent_message", message: `Evidence ${index}` }
    }));
    const lines = [
      { timestamp: "2026-07-21T00:00:00Z", type: "session_meta", payload: { id: "session-large", cwd: "/tmp/agentcarry-large", cli_version: "0.145.0-alpha.18", source: "vscode", thread_source: "user" } },
      { timestamp: "2026-07-21T00:00:01Z", type: "event_msg", payload: { type: "task_started" } },
      { timestamp: "2026-07-21T00:00:02Z", type: "event_msg", payload: { type: "user_message", message: "Read a large session." } },
      ...messages,
      { timestamp: "2026-07-21T00:00:04Z", type: "event_msg", payload: { type: "task_complete" } }
    ];
    await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
    const before = await hash(path);
    const reader = new CodexSourceReader({ sessionRoot: root });
    const session = await reader.select({ cwd: "/tmp/agentcarry-large" });
    const count = (await reader.capture(session)).events.length;

    expect(count).toBe(5_003);
    expect(await hash(path)).toBe(before);
  });
});
