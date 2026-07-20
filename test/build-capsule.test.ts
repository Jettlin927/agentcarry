import { describe, expect, it } from "vitest";
import type { CanonicalSourceEvent, SourceSession } from "../src/adapters/source-reader.js";
import {
  CapsuleBuildError,
  buildWorkCapsule,
  type WorkCapsule
} from "../src/capsule/build-capsule.js";
import { validateWorkCapsule } from "../src/capsule/validate-capsule.js";
import type { CollectedWorkspaceEvidence } from "../src/workspace/collect-workspace.js";

const session: SourceSession = {
  agent: "codex",
  id: "session-1",
  path: "C:\\Users\\dev\\.codex\\session-1.jsonl",
  cwd: "C:\\Users\\dev\\中文 项目",
  agentVersion: "0.145.0-alpha.18",
  modifiedAt: "2026-07-21T00:00:00Z",
  kind: "main",
  activity: "idle",
  hasMessages: true
};

const workspace: CollectedWorkspaceEvidence = {
  workspace: {
    primaryRoot: "C:\\Users\\dev\\中文 项目",
    additionalRoots: [],
    capturedAt: "2026-07-21T00:00:01Z",
    git: {
      repoRoot: "C:\\Users\\dev\\中文 项目",
      branch: "feature/capsule",
      head: "abc123",
      dirty: true
    },
    instructionFiles: [
      {
        path: "C:\\Users\\dev\\中文 项目\\AGENTS.md",
        sha256: "a".repeat(64),
        scope: "repository"
      }
    ]
  },
  files: [
    {
      path: "src/parser.ts",
      kind: "modified",
      sha256: "b".repeat(64),
      evidenceRefs: ["workspace:git-status"]
    }
  ]
};

function sourceEvents(secret?: string): CanonicalSourceEvent[] {
  return [
    {
      id: "event-user-1",
      kind: "user-message",
      timestamp: "2026-07-21T00:00:00Z",
      locator: "session:1",
      text: "Fix the parser without changing exports."
    },
    {
      id: "event-tool-1",
      kind: "tool-call",
      timestamp: "2026-07-21T00:00:02Z",
      locator: "session:2",
      toolName: "exec_command",
      callId: "call-1",
      text: JSON.stringify({ cmd: "npm test" })
    },
    {
      id: "event-tool-output-1",
      kind: "tool-result",
      timestamp: "2026-07-21T00:00:03Z",
      locator: "session:3",
      callId: "call-1",
      text: "1 test failed; the cache hypothesis was rejected."
    },
    {
      id: "event-assistant-1",
      kind: "assistant-message",
      timestamp: "2026-07-21T00:00:04Z",
      locator: "session:4",
      text: `Parser is modified; focused test remains pending.${secret === undefined ? "" : ` Token ${secret}`}`
    },
    {
      id: "event-user-2",
      kind: "user-message",
      timestamp: "2026-07-21T00:00:05Z",
      locator: "session:5",
      text: "Write the focused regression next."
    },
    {
      id: "event-attachment-1",
      kind: "attachment",
      timestamp: "2026-07-21T00:00:05Z",
      locator: "session:5",
      attachmentPath: "C:\\Users\\dev\\中文 项目\\error.png"
    }
  ];
}

describe("buildWorkCapsule", () => {
  it("builds a schema-valid capsule with verbatim current message and fresh workspace", () => {
    const result = buildWorkCapsule(session, sourceEvents(), workspace, {
      now: () => new Date("2026-07-21T00:00:10Z")
    });

    expect(validateWorkCapsule(result.capsule)).toEqual([]);
    expect(result.capsule.currentUserMessage.text).toBe("Write the focused regression next.");
    expect(result.capsule.workspace).toEqual(workspace.workspace);
    expect(result.capsule.commands).toContainEqual(expect.objectContaining({ command: "npm test" }));
    expect(result.capsule.validations).toContainEqual(
      expect.objectContaining({ status: "failed" })
    );
    expect(result.capsule.losses.map((loss) => loss.code)).toContain(
      "ATTACHMENTS_NOT_TRANSFERRED"
    );
    expect(result.receipt).toMatchObject({ canContinue: true, forced: false, criticalLosses: 0 });
  });

  it("redacts secrets before the capsule or receipt can render them", () => {
    const secret = `sk-${"x".repeat(32)}`;

    const result = buildWorkCapsule(session, sourceEvents(secret), workspace);
    const rendered = JSON.stringify(result);

    expect(rendered).not.toContain(secret);
    expect(rendered).toContain("[REDACTED:OPENAI_API_KEY]");
    expect(result.capsule.losses).toContainEqual(
      expect.objectContaining({ code: "SENSITIVE_VALUES_REDACTED" })
    );
  });

  it("allows sensitive values only through an explicit in-memory option", () => {
    const secret = `sk-${"y".repeat(32)}`;

    const result = buildWorkCapsule(session, sourceEvents(secret), workspace, {
      allowSensitive: true
    });

    expect(JSON.stringify(result.capsule)).toContain(secret);
    expect(result.capsule.losses).toContainEqual(
      expect.objectContaining({ code: "SENSITIVE_VALUES_ALLOWED" })
    );
  });

  it("fails structurally when the current user message is unavailable", () => {
    const events = sourceEvents().filter((event) => event.kind !== "user-message");

    expect(() => buildWorkCapsule(session, events, workspace)).toThrowError(
      expect.objectContaining<Partial<CapsuleBuildError>>({ code: "CURRENT_USER_MESSAGE_MISSING" })
    );
  });

  it("requires force for a critical semantic loss", () => {
    const events = sourceEvents().filter((event) => event.kind !== "assistant-message");
    const normal = buildWorkCapsule(session, events, workspace);
    const forced = buildWorkCapsule(session, events, workspace, { force: true });

    expect(normal.receipt).toMatchObject({ canContinue: false, criticalLosses: 1 });
    expect(forced.receipt).toMatchObject({ canContinue: true, forced: true, criticalLosses: 1 });
  });

  it("preserves original evidence and lineage across a second hop", () => {
    const first = buildWorkCapsule(session, sourceEvents(), workspace, {
      now: () => new Date("2026-07-21T00:00:10Z")
    });
    const secondSession = { ...session, agent: "claude", id: "session-2" };
    const second = buildWorkCapsule(secondSession, sourceEvents(), workspace, {
      now: () => new Date("2026-07-21T00:00:20Z"),
      parentCapsule: first.capsule
    });

    expect(second.capsule.lineage.rootCapsuleId).toBe(first.capsule.lineage.rootCapsuleId);
    expect(second.capsule.lineage.parentCapsuleId).toBe(first.capsule.lineage.capsuleId);
    expect(second.capsule.lineage.hops).toHaveLength(2);
    expect(second.capsule.evidenceRefs).toEqual(
      expect.arrayContaining([...first.capsule.evidenceRefs])
    );
  });

  it("rejects duplicate evidence ids instead of silently rebinding facts", () => {
    const events = sourceEvents();
    events[1] = { ...events[1]!, id: events[0]!.id };

    expect(() => buildWorkCapsule(session, events, workspace)).toThrow(
      "duplicate evidence id event-user-1"
    );
  });
});
