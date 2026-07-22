import { describe, expect, it, vi } from "vitest";
import {
  ExitCode,
  runCli,
  type CliHandlers,
  type CliIo,
  type CommandSuccess
} from "../src/cli.js";

function harness(answer?: string): {
  io: CliIo;
  stdout: string[];
  stderr: string[];
  readLine: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const readLine = vi.fn(async () => answer ?? "");
  const release = vi.fn();
  return {
    stdout,
    stderr,
    readLine,
    release,
    io: {
      stdout: { write: (value) => { stdout.push(value); } },
      stderr: { write: (value) => { stderr.push(value); } },
      stdin: { readLine, release }
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
      force: false,
      active: false
    });
    expect(handlers.launchContinue).not.toHaveBeenCalled();
    expect(() => JSON.parse(output.stdout.join(""))).not.toThrow();
    expect(output.stderr).toEqual([]);
  });

  it("crosses the launch seam only for a prepared non-dry-run continue", async () => {
    const output = harness("yes");
    const handlers = successfulHandlers();
    handlers.prepareContinue = vi.fn(async () => ({
      ok: true as const,
      data: { accepted: true },
      human: "Prepared handoff"
    }));

    expect(await runCli(["continue", "--to", "claude"], output.io, handlers)).toBe(
      ExitCode.success
    );
    expect(handlers.prepareContinue).toHaveBeenCalledOnce();
    expect(handlers.launchContinue).toHaveBeenCalledOnce();
    expect(output.readLine).toHaveBeenCalledOnce();
    expect(output.release).toHaveBeenCalledOnce();
    expect(output.stdout.join("")).toContain("Prepared handoff\n");
    expect(output.stderr.join("")).toBe("Launch Claude Code now? [y/N] ");
  });

  it("cancels safely after one non-affirmative answer", async () => {
    const output = harness("no");
    const handlers = successfulHandlers();
    handlers.prepareContinue = vi.fn(async () => ({
      ok: true as const,
      data: { accepted: true },
      human: "Prepared handoff"
    }));

    expect(await runCli(["continue", "--to", "claude"], output.io, handlers)).toBe(
      ExitCode.success
    );
    expect(output.readLine).toHaveBeenCalledOnce();
    expect(output.release).toHaveBeenCalledOnce();
    expect(handlers.launchContinue).not.toHaveBeenCalled();
    expect(output.stdout.join("")).toBe(
      "Prepared handoff\nLaunch cancelled; no target process was started.\n"
    );
  });

  it("fails closed when interactive confirmation has no stdin", async () => {
    const output = harness();
    const handlers = successfulHandlers();
    const io: CliIo = { stdout: output.io.stdout, stderr: output.io.stderr };

    expect(await runCli(["continue", "--to", "claude"], io, handlers)).toBe(
      ExitCode.usage
    );
    expect(handlers.prepareContinue).not.toHaveBeenCalled();
    expect(handlers.launchContinue).not.toHaveBeenCalled();
    expect(output.stderr.join("")).toContain("CONFIRMATION_STDIN_UNAVAILABLE");
  });

  it("rejects interactive launch in JSON mode without reading the source", async () => {
    const output = harness("yes");
    const handlers = successfulHandlers();

    expect(await runCli([
      "continue", "--to", "claude", "--json"
    ], output.io, handlers)).toBe(ExitCode.usage);
    expect(handlers.prepareContinue).not.toHaveBeenCalled();
    expect(handlers.launchContinue).not.toHaveBeenCalled();
    expect(output.readLine).not.toHaveBeenCalled();
    expect(JSON.parse(output.stdout.join(""))).toMatchObject({
      ok: false,
      code: "INTERACTIVE_JSON_UNSUPPORTED"
    });
  });

  it("requires paired active checkpoint flags", async () => {
    const output = harness();
    const handlers = successfulHandlers();

    expect(await runCli([
      "continue", "--to", "claude", "--active", "--dry-run"
    ], output.io, handlers)).toBe(ExitCode.usage);
    expect(handlers.prepareContinue).not.toHaveBeenCalled();
    expect(output.stderr.join("")).toContain("requires both --active and --checkpoint-stdin");
  });

  it("signals readiness and reads one active checkpoint from stdin", async () => {
    const output = harness();
    const checkpoint = JSON.stringify({
      schemaVersion: "1.0.0",
      currentUserMessage: "Switch this active task.",
      assistantCheckpoint: "Implementation is complete; run the full suite next."
    });
    const io: CliIo = {
      ...output.io,
      stdin: { readLine: vi.fn(async () => checkpoint) }
    };
    const handlers = successfulHandlers();
    handlers.prepareContinue = vi.fn(async (options) => {
      options.checkpointStdin!.ready();
      const received = await options.checkpointStdin!.read();
      return { ok: true as const, data: { received } };
    });

    expect(await runCli([
      "continue", "--to", "claude", "--active", "--checkpoint-stdin", "--dry-run", "--json"
    ], io, handlers)).toBe(ExitCode.success);
    expect(output.stderr.join("")).toBe("CHECKPOINT_STDIN_READY\n");
    expect(handlers.prepareContinue).toHaveBeenCalledWith(expect.objectContaining({
      active: true,
      checkpointStdin: expect.any(Object)
    }));
    expect(JSON.parse(output.stdout.join("")).data).toEqual({ received: checkpoint });
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

  it("uses human doctor rendering without adding it to stable JSON", async () => {
    const handlers = successfulHandlers();
    handlers.doctor = vi.fn(async () => ({
      ok: true as const,
      data: { checks: [] },
      human: "AgentCarry doctor\nall local"
    }));
    const human = harness();
    const machine = harness();

    expect(await runCli(["doctor"], human.io, handlers)).toBe(ExitCode.success);
    expect(human.stdout.join("")).toBe("AgentCarry doctor\nall local\n");
    expect(await runCli(["doctor", "--json"], machine.io, handlers)).toBe(ExitCode.success);
    expect(JSON.parse(machine.stdout.join(""))).toEqual({
      schemaVersion: "1.0.0",
      command: "doctor",
      ok: true,
      data: { checks: [] }
    });
    expect(machine.stdout.join("")).not.toContain("all local");
  });
});
