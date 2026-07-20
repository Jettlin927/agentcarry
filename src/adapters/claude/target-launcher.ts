import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { CapsuleBuildResult, CapsuleLoss, WorkCapsule } from "../../capsule/build-capsule.js";
import type {
  LaunchStep,
  PreparedTargetLaunch,
  TargetDiagnostic,
  TargetLauncher
} from "../target-launcher.js";

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (
  command: string,
  args: readonly string[]
) => Promise<CommandResult>;

export interface ClaudeTargetLauncherOptions {
  readonly cwd: string;
  readonly createSessionId?: () => string;
  readonly runCommand?: CommandRunner;
}

export const claudeLauncherMetadata = {
  agent: "claude",
  adapterVersion: "0.1.0",
  interface: "official-cli",
  observedClaudeVersions: ["2.1.158"],
  changesModel: false,
  changesPermissions: false,
  managesAuthentication: false
} as const;

export const defaultCommandRunner: CommandRunner = async (command, args) =>
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({
      exitCode: exitCode ?? 1,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8")
    }));
  });

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

export function renderCapsuleJson(capsule: WorkCapsule): string {
  return `${JSON.stringify(canonicalize(capsule), null, 2)}\n`;
}

function lossRow(loss: CapsuleLoss): string {
  const escapeCell = (value: string): string => value.replaceAll("|", "\\|").replaceAll("\n", " ");
  const fields = loss.affectedFields.length === 0 ? "—" : loss.affectedFields.join(", ");
  return `| ${escapeCell(loss.severity)} | ${escapeCell(loss.code)} | ${escapeCell(loss.description)} | ${escapeCell(fields)} |`;
}

export function renderCapsuleMarkdown(capsule: WorkCapsule): string {
  const capsuleJson = renderCapsuleJson(capsule).trimEnd();
  const losses = capsule.losses.map(lossRow).join("\n");
  return `# AgentCarry Work Capsule

## Loss receipt

| Severity | Code | Description | Affected fields |
| --- | --- | --- | --- |
${losses}

## Canonical capsule

\`\`\`json
${capsuleJson}
\`\`\`
`;
}

export function buildContinuationPrompt(capsule: WorkCapsule): string {
  return `You are continuing an existing coding task from another coding agent.

1. Restate the objective, critical constraints, completed work, pending work, and next action from the Work Capsule.
2. Verify the current workspace and reread native instruction files referenced by path. Current workspace facts override stale transcript claims.
3. If the workspace is consistent and the next action is clear, continue the task. If evidence conflicts or a critical decision is unclear, ask the user before editing.
4. Do not claim hidden reasoning, prompt caches, permissions, tools, tests, or attachments transferred when the loss receipt says they did not.
5. Keep the source session unchanged.

${renderCapsuleMarkdown(capsule)}`;
}

function seedStep(cwd: string, sessionId: string): LaunchStep {
  const args = ["--session-id", sessionId, "--print", "--output-format", "json"];
  return {
    purpose: "seed-session",
    command: "claude",
    args,
    cwd,
    stdin: "capsule-prompt",
    displayCommand: `claude --session-id ${sessionId} --print --output-format json < capsule-prompt`
  };
}

function resumeStep(cwd: string, sessionId: string): LaunchStep {
  const args = ["--resume", sessionId];
  return {
    purpose: "resume-interactive",
    command: "claude",
    args,
    cwd,
    stdin: "inherit",
    displayCommand: `claude --resume ${sessionId}`
  };
}

interface ClaudeAuthStatus {
  readonly loggedIn?: unknown;
  readonly authMethod?: unknown;
  readonly apiProvider?: unknown;
  readonly subscriptionType?: unknown;
}

export class ClaudeTargetLauncher implements TargetLauncher {
  readonly agent = "claude";
  readonly #cwd: string;
  readonly #createSessionId: () => string;
  readonly #runCommand: CommandRunner;

  constructor(options: ClaudeTargetLauncherOptions) {
    this.#cwd = options.cwd;
    this.#createSessionId = options.createSessionId ?? randomUUID;
    this.#runCommand = options.runCommand ?? defaultCommandRunner;
  }

  prepare(result: CapsuleBuildResult): PreparedTargetLaunch {
    const targetSessionId = this.#createSessionId();
    return {
      agent: this.agent,
      targetSessionId,
      capsule: result.capsule,
      capsuleJson: renderCapsuleJson(result.capsule),
      capsuleMarkdown: renderCapsuleMarkdown(result.capsule),
      lossReceipt: result.receipt,
      prompt: buildContinuationPrompt(result.capsule),
      steps: [
        seedStep(this.#cwd, targetSessionId),
        resumeStep(this.#cwd, targetSessionId)
      ],
      prerequisitesVerified: false
    };
  }

  async diagnose(): Promise<TargetDiagnostic> {
    let version: CommandResult;
    try {
      version = await this.#runCommand("claude", ["--version"]);
    } catch (error: unknown) {
      return {
        agent: this.agent,
        available: false,
        version: null,
        authentication: "unknown",
        details: [error instanceof Error ? error.message : String(error)]
      };
    }
    if (version.exitCode !== 0) {
      return {
        agent: this.agent,
        available: false,
        version: null,
        authentication: "unknown",
        details: [version.stderr.trim() || `claude --version exited ${version.exitCode}`]
      };
    }

    let auth: CommandResult;
    try {
      auth = await this.#runCommand("claude", ["auth", "status", "--json"]);
    } catch (error: unknown) {
      return {
        agent: this.agent,
        available: true,
        version: version.stdout.trim(),
        authentication: "unknown",
        details: [error instanceof Error ? error.message : String(error)]
      };
    }
    if (auth.exitCode !== 0) {
      return {
        agent: this.agent,
        available: true,
        version: version.stdout.trim(),
        authentication: "unknown",
        details: [auth.stderr.trim() || `claude auth status exited ${auth.exitCode}`]
      };
    }
    try {
      const status = JSON.parse(auth.stdout) as ClaudeAuthStatus;
      const details = [status.authMethod, status.apiProvider, status.subscriptionType]
        .filter((value): value is string => typeof value === "string" && value.length > 0);
      return {
        agent: this.agent,
        available: true,
        version: version.stdout.trim(),
        authentication: status.loggedIn === true ? "reported-authenticated" : "reported-missing",
        details
      };
    } catch {
      return {
        agent: this.agent,
        available: true,
        version: version.stdout.trim(),
        authentication: "unknown",
        details: ["claude auth status returned invalid JSON"]
      };
    }
  }
}
