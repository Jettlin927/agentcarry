export const ExitCode = {
  success: 0,
  internal: 1,
  usage: 2,
  source: 3,
  criticalLoss: 4,
  target: 5
} as const;

export type ExitCodeValue = typeof ExitCode[keyof typeof ExitCode];

export interface InspectOptions {
  readonly session?: string;
}

export interface ContinueOptions {
  readonly target: string;
  readonly source?: string;
  readonly session?: string;
  readonly force: boolean;
  readonly active?: boolean;
  readonly checkpointStdin?: {
    ready(): void;
    read(): Promise<string>;
  };
}

export interface CommandSuccess {
  readonly ok: true;
  readonly data: unknown;
  readonly human?: string;
}

export interface CommandFailure {
  readonly ok: false;
  readonly exitCode: ExitCodeValue;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export type CommandResult = CommandSuccess | CommandFailure;

export interface CliHandlers {
  inspect(options: InspectOptions): Promise<CommandResult>;
  prepareContinue(options: ContinueOptions): Promise<CommandResult>;
  launchContinue(options: ContinueOptions, prepared: CommandSuccess): Promise<CommandResult>;
  doctor(): Promise<CommandResult>;
}

export interface CliIo {
  readonly stdout: { write(value: string): void };
  readonly stderr: { write(value: string): void };
  readonly stdin?: { readLine(): Promise<string> };
}

export const agentCarryVersion = "0.0.0-development";

const help = `AgentCarry ${agentCarryVersion}

Continue coding tasks across agents with evidence and explicit loss.

Usage:
  agentcarry inspect [--session <id>] [--json]
  agentcarry continue --to <agent> [--source <agent>] [--session <id>] [--active --checkpoint-stdin] [--dry-run] [--force] [--json]
  agentcarry doctor [--json]

Exit codes:
  0 success
  1 internal failure
  2 invalid usage
  3 source session unavailable or unreadable
  4 critical transfer loss
  5 target agent unavailable or launch failure
`;

function success(data: unknown): CommandSuccess {
  return { ok: true, data };
}

function failure(
  exitCode: ExitCodeValue,
  code: string,
  message: string,
  details?: unknown
): CommandFailure {
  return {
    ok: false,
    exitCode,
    code,
    message,
    ...(details === undefined ? {} : { details })
  };
}

export const defaultCliHandlers: CliHandlers = {
  async inspect() {
    return failure(
      ExitCode.source,
      "SOURCE_ADAPTER_NOT_IMPLEMENTED",
      "No Source Reader is available in this development build."
    );
  },
  async prepareContinue() {
    return failure(
      ExitCode.source,
      "SOURCE_ADAPTER_NOT_IMPLEMENTED",
      "No Source Reader is available in this development build."
    );
  },
  async launchContinue() {
    return failure(
      ExitCode.target,
      "TARGET_ADAPTER_NOT_IMPLEMENTED",
      "No Target Launcher is available in this development build."
    );
  },
  async doctor() {
    return success({
      status: "development",
      checks: [],
      installsAgents: false,
      managesAuthentication: false,
      telemetry: false,
      updateCheck: false
    });
  }
};

interface ParsedArguments {
  readonly command?: string;
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
  readonly json: boolean;
  readonly help: boolean;
  readonly version: boolean;
  readonly error?: string;
}

const valueOptions = new Set(["--to", "--source", "--session"]);
const booleanOptions = new Set(["--active", "--checkpoint-stdin", "--dry-run", "--force", "--json", "--help", "-h", "--version", "-v"]);

function parseArguments(argv: readonly string[]): ParsedArguments {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  let command: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (valueOptions.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return { values, flags, json: flags.has("--json"), help: false, version: false, error: `${argument} requires a value` };
      }
      values.set(argument, value);
      index += 1;
      continue;
    }
    if (booleanOptions.has(argument)) {
      flags.add(argument);
      continue;
    }
    if (argument.startsWith("-")) {
      return { values, flags, json: flags.has("--json"), help: false, version: false, error: `unknown option ${argument}` };
    }
    if (command !== undefined) {
      return { values, flags, json: flags.has("--json"), help: false, version: false, error: `unexpected argument ${argument}` };
    }
    command = argument;
  }

  return {
    ...(command === undefined ? {} : { command }),
    values,
    flags,
    json: flags.has("--json"),
    help: flags.has("--help") || flags.has("-h"),
    version: flags.has("--version") || flags.has("-v")
  };
}

function jsonEnvelope(command: string | undefined, result: CommandResult): string {
  return `${JSON.stringify({
    schemaVersion: "1.0.0",
    command: command ?? null,
    ...(result.ok
      ? { ok: true, data: result.data }
      : result)
  })}\n`;
}

function writeResult(
  io: CliIo,
  command: string | undefined,
  result: CommandResult,
  json: boolean
): ExitCodeValue {
  if (json) {
    io.stdout.write(jsonEnvelope(command, result));
    if (!result.ok) {
      io.stderr.write(`${result.code}: ${result.message}\n`);
    }
  } else if (result.ok) {
    io.stdout.write(`${result.human ?? (typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2))}\n`);
  } else {
    io.stderr.write(`${result.code}: ${result.message}\n`);
  }
  return result.ok ? ExitCode.success : result.exitCode;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo,
  handlers: CliHandlers = defaultCliHandlers
): Promise<ExitCodeValue> {
  try {
    const parsed = parseArguments(argv);
    if (parsed.error !== undefined) {
      return writeResult(
        io,
        parsed.command,
        failure(ExitCode.usage, "INVALID_USAGE", parsed.error),
        parsed.json
      );
    }
    if (parsed.version) {
      const result = success({ version: agentCarryVersion });
      return parsed.json
        ? writeResult(io, parsed.command, result, true)
        : (io.stdout.write(`${agentCarryVersion}\n`), ExitCode.success);
    }
    if (parsed.help || parsed.command === undefined) {
      const result = success({ help, version: agentCarryVersion });
      return parsed.json
        ? writeResult(io, parsed.command, result, true)
        : (io.stdout.write(help), ExitCode.success);
    }

    if (parsed.command === "inspect") {
      const session = parsed.values.get("--session");
      return writeResult(
        io,
        parsed.command,
        await handlers.inspect({
          ...(session === undefined ? {} : { session })
        }),
        parsed.json
      );
    }

    if (parsed.command === "continue") {
      const target = parsed.values.get("--to");
      if (target === undefined) {
        return writeResult(
          io,
          parsed.command,
          failure(ExitCode.usage, "INVALID_USAGE", "continue requires --to <agent>"),
          parsed.json
        );
      }
      const source = parsed.values.get("--source");
      const session = parsed.values.get("--session");
      const active = parsed.flags.has("--active");
      const checkpointStdin = parsed.flags.has("--checkpoint-stdin");
      if (active !== checkpointStdin) {
        return writeResult(
          io,
          parsed.command,
          failure(
            ExitCode.usage,
            "INVALID_USAGE",
            "active handoff requires both --active and --checkpoint-stdin"
          ),
          parsed.json
        );
      }
      if (checkpointStdin && io.stdin === undefined) {
        return writeResult(
          io,
          parsed.command,
          failure(ExitCode.usage, "CHECKPOINT_STDIN_UNAVAILABLE", "checkpoint stdin is unavailable"),
          parsed.json
        );
      }
      const options: ContinueOptions = {
        target,
        ...(source === undefined ? {} : { source }),
        ...(session === undefined ? {} : { session }),
        force: parsed.flags.has("--force"),
        active,
        ...(checkpointStdin
          ? {
              checkpointStdin: {
                ready: () => { io.stderr.write("CHECKPOINT_STDIN_READY\n"); },
                read: async () => await io.stdin!.readLine()
              }
            }
          : {})
      };
      const prepared = await handlers.prepareContinue(options);
      if (!prepared.ok || parsed.flags.has("--dry-run")) {
        return writeResult(io, parsed.command, prepared, parsed.json);
      }
      return writeResult(
        io,
        parsed.command,
        await handlers.launchContinue(options, prepared),
        parsed.json
      );
    }

    if (parsed.command === "doctor") {
      return writeResult(io, parsed.command, await handlers.doctor(), parsed.json);
    }

    return writeResult(
      io,
      parsed.command,
      failure(ExitCode.usage, "UNKNOWN_COMMAND", `unknown command ${parsed.command}`),
      parsed.json
    );
  } catch (error: unknown) {
    return writeResult(
      io,
      argv[0],
      failure(
        ExitCode.internal,
        "INTERNAL_ERROR",
        error instanceof Error ? error.message : String(error)
      ),
      argv.includes("--json")
    );
  }
}
