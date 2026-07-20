import { describe, expect, it } from "vitest";
import type {
  CapturedSource,
  SourceSession
} from "../src/adapters/source-reader.js";
import {
  ActiveCheckpointError,
  attachActiveCheckpoint,
  parseActiveCheckpoint
} from "../src/checkpoint/active-checkpoint.js";

const session: SourceSession = {
  agent: "codex",
  id: "active-session",
  path: "C:\\sessions\\active.jsonl",
  cwd: "C:\\repo",
  agentVersion: "test",
  modifiedAt: "2026-07-21T00:00:00Z",
  kind: "main",
  activity: "active",
  hasMessages: true
};

const captured: CapturedSource = {
  events: [
    {
      id: "user-1",
      kind: "user-message",
      timestamp: "2026-07-21T00:00:00Z",
      locator: "active.jsonl:2",
      text: "把当前任务切换到另一个 Agent。"
    }
  ],
  snapshot: {
    capturedAt: "2026-07-21T00:01:00Z",
    byteLength: 100,
    sha256: "a".repeat(64),
    changedDuringCapture: true,
    trailingFragmentIgnored: true
  }
};

function input(currentUserMessage = "把当前任务切换到另一个 Agent。"): string {
  return JSON.stringify({
    schemaVersion: "1.0.0",
    currentUserMessage,
    assistantCheckpoint: "已修改解析器；全量测试尚未运行。下一步执行 npm test。"
  });
}

describe("active checkpoint", () => {
  it("attaches a hashed, complete source-agent checkpoint to a native snapshot", () => {
    const result = attachActiveCheckpoint(session, captured, input());
    const checkpoint = result.events.at(-1)!;

    expect(checkpoint).toMatchObject({
      kind: "agent-checkpoint",
      timestamp: captured.snapshot.capturedAt,
      text: "已修改解析器；全量测试尚未运行。下一步执行 npm test。"
    });
    expect(checkpoint.locator).toMatch(/^checkpoint:stdin:[a-f0-9]{64}$/);
    expect(result.snapshot).toBe(captured.snapshot);
  });

  it("rejects user-message changes beyond transport line endings", () => {
    expect(() => attachActiveCheckpoint(session, captured, input("意思相同但不是原文"))).toThrowError(
      expect.objectContaining<Partial<ActiveCheckpointError>>({ code: "CHECKPOINT_MESSAGE_MISMATCH" })
    );
  });

  it("ignores only transport line endings while retaining the native message", () => {
    const nativeWithEnding: CapturedSource = {
      ...captured,
      events: captured.events.map((event) => ({
        ...event,
        text: `${event.text}\r\n`
      }))
    };

    const result = attachActiveCheckpoint(session, nativeWithEnding, input());

    expect(result.events[0]?.text).toBe("把当前任务切换到另一个 Agent。\r\n");
  });

  it("rejects invalid fields and accepts a UTF-8 BOM", () => {
    expect(parseActiveCheckpoint(`\uFEFF${input()}`)).toMatchObject({ schemaVersion: "1.0.0" });
    expect(() => parseActiveCheckpoint(JSON.stringify({
      schemaVersion: "1.0.0",
      currentUserMessage: "message",
      assistantCheckpoint: "checkpoint",
      hiddenReasoning: "must not transfer"
    }))).toThrowError(expect.objectContaining<Partial<ActiveCheckpointError>>({
      code: "CHECKPOINT_INVALID"
    }));
  });

  it("does not attach a checkpoint to an idle session", () => {
    expect(() => attachActiveCheckpoint({ ...session, activity: "idle" }, captured, input())).toThrowError(
      expect.objectContaining<Partial<ActiveCheckpointError>>({ code: "CHECKPOINT_SESSION_NOT_ACTIVE" })
    );
  });
});
