import { describe, expect, it, vi } from "vitest";
import {
  ExitCode,
  runCli,
  type CliHandlers,
  type CliIo,
  type CommandSuccess
} from "../src/cli.js";

function harness(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: { write: (value) => { stdout.push(value); } },
      stderr: { write: (value) => { stderr.push(value); } }
    }
  };
}

function successfulHandlers(): CliHandlers {
  const result: CommandSuccess = { ok: true, data: { accepted: true } };
  return {
    inspect: vi.fn(async () => result),
    prepareContinue: vi.fn(async () => result),
    launchContinue: vi.fn(async () => result),
    doctor: vi.fn(async () => result)
  };
}

describe("AgentCarry CLI contract", () => {
  it("prints a small public command surface", async () => {
    const output = harness();

    expect(await runCli(["--help"], output.io)).toBe(ExitCode.success);
    expect(output.stdout.join("")).toContain("agentcarry inspect");
    expect(output.stdout.join("")).toContain("agentcarry continue --to <agent>");
    expect(output.stdout.join("")).toContain("agentcarry doctor");
  });

  it("writes JSON only to stdout and diagnostics to stderr on failure", async () => {
    const output = harness();

    const exitCode = await runCli(["unknown", "--json"], output.io);
    const envelope = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      exitCode: number;
      code: string;
    };

    expect(exitCode).toBe(ExitCode.usage);
    expect(envelope).toMatchObject({ ok: false, exitCode: 2, code: "UNKNOWN_COMMAND" });
    expect(output.stderr.join("")).toContain("UNKNOWN_COMMAND");
  });

  it("requires an explicit target before calling continue", async () => {
    const output = harness();
    const handlers = successfulHandlers();

    expect(await runCli(["continue", "--dry-run"], output.io, handlers)).toBe(
      ExitCode.usage
    );
    expect(handlers.prepareContinue).not.toHaveBeenCalled();
    expect(handlers.launchContinue).not.toHaveBeenCalled();
  });

  it("passes dry-run and selectors through the stable handler interface", async () => {
    const output = harness();
    const handlers = successfulHandlers();

    expect(await runCli([
      "continue",
      "--to",
      "claude",
      "--source",
      "codex",
      "--session",
      "session-1",
      "--dry-run",
      "--json"
    ], output.io, handlers)).toBe(ExitCode.success);
    expect(handlers.prepareContinue).toHaveBeenCalledWith({
      target: "claude",
      source: "codex",
      session: "session-1",
      force: false
    });
    expect(handlers.launchContinue).not.toHaveBeenCalled();
    expect(() => JSON.parse(output.stdout.join(""))).not.toThrow();
    expect(output.stderr).toEqual([]);
  });

  it("crosses the launch seam only for a prepared non-dry-run continue", async () => {
    const output = harness();
    const handlers = successfulHandlers();

    expect(await runCli(["continue", "--to", "claude"], output.io, handlers)).toBe(
      ExitCode.success
    );
    expect(handlers.prepareContinue).toHaveBeenCalledOnce();
    expect(handlers.launchContinue).toHaveBeenCalledOnce();
  });

  it("doctor declares that it does not install agents or manage auth", async () => {
    const output = harness();

    expect(await runCli(["doctor", "--json"], output.io)).toBe(ExitCode.success);
    const envelope = JSON.parse(output.stdout.join("")) as {
      data: { installsAgents: boolean; managesAuthentication: boolean; telemetry: boolean };
    };
    expect(envelope.data).toMatchObject({
      installsAgents: false,
      managesAuthentication: false,
      telemetry: false
    });
  });
});
