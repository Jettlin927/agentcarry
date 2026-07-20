import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeTargetLauncher } from "../src/adapters/claude/target-launcher.js";
import { CodexSourceReader } from "../src/adapters/codex/source-reader.js";
import { createAgentCarryHandlers } from "../src/application.js";
import { ExitCode, runCli, type CliIo } from "../src/cli.js";

const temporaryRoots: string[] = [];

function hash(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex to Claude dry-run tracer bullet", () => {
  it("selects the current workspace, carries evidence, and leaves source bytes unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentcarry-tracer-test-"));
    temporaryRoots.push(root);
    const workspace = join(root, "workspace");
    const sessions = join(root, "sessions");
    const sessionPath = join(sessions, "idle.jsonl");
    await mkdir(workspace);
    await mkdir(sessions);
    const lines = [
      { timestamp: "2026-07-21T00:00:00Z", type: "session_meta", payload: { id: "tracer-session", cwd: workspace, cli_version: "test", source: "vscode", thread_source: "user" } },
      { timestamp: "2026-07-21T00:00:01Z", type: "event_msg", payload: { type: "task_started" } },
      { timestamp: "2026-07-21T00:00:02Z", type: "event_msg", payload: { type: "user_message", message: "Fix the parser without changing exports." } },
      { timestamp: "2026-07-21T00:00:03Z", type: "event_msg", payload: { type: "agent_message", message: "The parser edit is complete; tests are pending." } },
      { timestamp: "2026-07-21T00:00:04Z", type: "event_msg", payload: { type: "task_complete" } }
    ];
    await writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
    const before = hash(await readFile(sessionPath));
    const claudeRunner = vi.fn();
    const handlers = createAgentCarryHandlers({
      cwd: workspace,
      codexReader: new CodexSourceReader({ sessionRoot: sessions }),
      createClaudeLauncher: (cwd) => new ClaudeTargetLauncher({
        cwd,
        createSessionId: () => "11111111-1111-4111-8111-111111111111",
        runCommand: claudeRunner
      })
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io: CliIo = {
      stdout: { write: (value) => { stdout.push(value); } },
      stderr: { write: (value) => { stderr.push(value); } }
    };

    const exitCode = await runCli([
      "continue",
      "--to",
      "claude",
      "--dry-run",
      "--json"
    ], io, handlers);
    const envelope = JSON.parse(stdout.join("")) as {
      data: {
        capsule: { source: { sessionId: string }; evidenceRefs: unknown[]; losses: unknown[] };
        lossReceipt: { canContinue: boolean };
        steps: Array<{ displayCommand: string }>;
      };
    };

    expect(exitCode).toBe(ExitCode.success);
    expect(stderr).toEqual([]);
    expect(envelope.data.capsule.source.sessionId).toBe("tracer-session");
    expect(envelope.data.capsule.evidenceRefs.length).toBeGreaterThan(0);
    expect(envelope.data.capsule.losses.length).toBeGreaterThan(0);
    expect(envelope.data.lossReceipt.canContinue).toBe(true);
    expect(envelope.data.steps.map((step) => step.displayCommand)).toEqual([
      "claude --session-id 11111111-1111-4111-8111-111111111111 --print --output-format json < capsule-prompt",
      "claude --resume 11111111-1111-4111-8111-111111111111"
    ]);
    expect(claudeRunner).not.toHaveBeenCalled();
    expect(hash(await readFile(sessionPath))).toBe(before);
  });
});
