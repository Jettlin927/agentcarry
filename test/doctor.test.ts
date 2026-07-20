import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandRunner } from "../src/adapters/claude/target-launcher.js";
import type { SourceReader, SourceSession } from "../src/adapters/source-reader.js";
import { diagnoseDoctor, renderDoctorReport } from "../src/diagnostics/doctor.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("read-only doctor diagnostics", () => {
  it("reports runtimes, adapters, storage, and no-side-effect policies", async () => {
    const userHome = await mkdtemp(join(tmpdir(), "agentcarry-doctor-"));
    temporaryRoots.push(userHome);
    const sessions = join(userHome, ".codex", "sessions");
    await mkdir(sessions, { recursive: true });
    const discoveredSession = {
      agent: "codex",
      id: "session-1",
      path: join(sessions, "session.jsonl"),
      cwd: userHome,
      agentVersion: "0.145.0-alpha.18",
      modifiedAt: "2026-07-21T00:00:00Z",
      kind: "main",
      activity: "idle",
      hasMessages: true
    } satisfies SourceSession;
    const reader: SourceReader = {
      agent: "codex",
      discover: vi.fn(async () => [discoveredSession]),
      select: vi.fn(),
      events: vi.fn()
    };
    const runCommand: CommandRunner = vi.fn(async () => ({
      exitCode: 0,
      stdout: "codex-cli 0.145.0-alpha.18\n",
      stderr: ""
    }));
    const report = await diagnoseDoctor({
      codexReader: reader,
      diagnoseClaude: async () => ({
        agent: "claude",
        available: true,
        version: "2.1.158 (Claude Code)",
        authentication: "reported-authenticated",
        details: ["claude.ai", "firstParty", "max"]
      }),
      userHome,
      runCommand
    });

    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "node", compatibility: "supported" }),
      expect.objectContaining({ id: "agentcarry", available: true }),
      expect.objectContaining({ id: "codex-cli", compatibility: "supported" }),
      expect.objectContaining({ id: "codex-reader", compatibility: "supported" }),
      expect.objectContaining({
        id: "claude-cli",
        compatibility: "supported",
        authentication: "reported-authenticated"
      }),
      expect.objectContaining({ id: "claude-launcher", compatibility: "supported" })
    ]));
    expect(report.storage).toEqual([
      expect.objectContaining({
        id: "codex-sessions",
        exists: true,
        readable: true,
        basis: "path",
        compatibility: "supported"
      }),
      expect.objectContaining({
        id: "agentcarry-lineage",
        exists: false,
        writable: true,
        basis: "nearest-existing-parent",
        compatibility: "supported"
      })
    ]);
    expect(report.policies).toEqual({
      installsAgents: false,
      managesAuthentication: false,
      mutatesConfiguration: false,
      networkTelemetry: false,
      updateCheck: false
    });
    expect(renderDoctorReport(report)).toContain("auth=reported-authenticated");
    expect(runCommand).toHaveBeenCalledWith("codex", ["--version"]);
  });

  it("degrades unverified versions and does not turn auth self-report into a live claim", async () => {
    const userHome = await mkdtemp(join(tmpdir(), "agentcarry-doctor-"));
    temporaryRoots.push(userHome);
    const reader: SourceReader = {
      agent: "codex",
      discover: vi.fn(async () => []),
      select: vi.fn(),
      events: vi.fn()
    };
    const report = await diagnoseDoctor({
      codexReader: reader,
      diagnoseClaude: async () => ({
        agent: "claude",
        available: true,
        version: "9.9.9 (Claude Code)",
        authentication: "reported-authenticated",
        details: []
      }),
      userHome,
      runCommand: async () => ({ exitCode: 0, stdout: "codex 9.9.9", stderr: "" })
    });

    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "codex-cli", compatibility: "degraded" }),
      expect.objectContaining({
        id: "claude-cli",
        compatibility: "degraded",
        authentication: "reported-authenticated",
        detail: expect.stringContaining("not a live provider request")
      })
    ]));
  });
});
