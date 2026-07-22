import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type {
  CapsuleBuildResult,
  CapsuleFact,
  CapsuleLoss,
  WorkCapsule
} from "../../capsule/build-capsule.js";
import type {
  LaunchStep,
  PreparedTargetLaunch,
  TargetDiagnostic,
  TargetLaunchOutcome,
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

export type LaunchRunner = (
  step: LaunchStep,
  stdin: string | undefined
) => Promise<CommandResult>;

export interface ClaudeTargetLauncherOptions {
  readonly cwd: string;
  readonly createSessionId?: () => string;
  readonly runCommand?: CommandRunner;
  readonly runLaunch?: LaunchRunner;
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

export const defaultLaunchRunner: LaunchRunner = async (step, stdin) =>
  await new Promise((resolve, reject) => {
    const captured = step.stdin === "capsule-prompt";
    const child = spawn(step.command, [...step.args], {
      cwd: step.cwd,
      env: process.env,
      shell: false,
      stdio: captured ? ["pipe", "pipe", "pipe"] : "inherit"
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({
      exitCode: exitCode ?? 1,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8")
    }));
    if (captured) {
      child.stdin?.end(stdin ?? "", "utf8");
    }
  });

export class TargetLaunchError extends Error {
  constructor(
    readonly code: string,
    readonly step: LaunchStep["purpose"],
    readonly exitCode?: number
  ) {
    super(exitCode === undefined
      ? `${step} could not start`
      : `${step} exited with code ${exitCode}`);
    this.name = "TargetLaunchError";
  }
}

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

interface BriefFact extends CapsuleFact {
  label?: string;
}

function normalizedFact(text: string): string {
  return compactText(text).toLocaleLowerCase("en-US");
}

function compactText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function evidenceLabel(evidenceRefs: readonly string[]): string {
  return evidenceRefs.length === 0 ? "none" : evidenceRefs.join(", ");
}

function renderBriefFact(fact: BriefFact): string {
  const label = fact.label === undefined ? "" : `${fact.label}: `;
  return `- ${label}${compactText(fact.text)} [evidence: ${evidenceLabel(fact.evidenceRefs)}]`;
}

function renderBriefSection(title: string, facts: readonly BriefFact[]): string {
  const rows = facts.length === 0 ? "- None evidenced." : facts.map(renderBriefFact).join("\n");
  return `## ${title}\n${rows}`;
}

export function renderContinuationBrief(capsule: WorkCapsule): string {
  const seen = new Map<string, BriefFact>();
  const add = (facts: readonly BriefFact[]): BriefFact[] => facts.flatMap((candidate) => {
    const key = normalizedFact(candidate.text);
    const existing = seen.get(key);
    if (existing !== undefined) {
      const evidenceRefs = [...new Set([...existing.evidenceRefs, ...candidate.evidenceRefs])];
      Object.assign(existing, { evidenceRefs });
      return [];
    }
    const stored = { ...candidate, text: compactText(candidate.text) };
    seen.set(key, stored);
    return [stored];
  });

  const first = add([capsule.nextAction.first]);
  const forbidden = add(capsule.nextAction.forbiddenBefore);
  const constraints = add(capsule.constraints);
  const currentState = add([
    { ...capsule.objective, label: "Objective" },
    { ...capsule.currentUserMessage, label: "Current request" },
    ...capsule.completed.map((item) => ({ ...item, label: "Completed" })),
    ...capsule.pending.map((item) => ({ ...item, label: "Pending" })),
    ...capsule.decisions.map((item) => ({ ...item, label: "Decision" })),
    ...capsule.failedAttempts.flatMap((item) => [
      { text: item.attempt, evidenceRefs: item.evidenceRefs, inferred: item.inferred, label: "Failed attempt" },
      { text: item.outcome, evidenceRefs: item.evidenceRefs, inferred: item.inferred, label: "Failed outcome" },
      ...(item.reason === undefined
        ? []
        : [{ text: item.reason, evidenceRefs: item.evidenceRefs, inferred: item.inferred, label: "Failure reason" }])
    ]),
    ...capsule.openQuestions.map((item) => ({ ...item, label: "Open question" }))
  ]);
  const later = add(capsule.nextAction.then);
  const losses = capsule.losses.length === 0
    ? "- None recorded."
    : capsule.losses.map((loss) =>
        `- ${loss.severity.toUpperCase()} ${loss.code}: ${compactText(loss.description)}`
      ).join("\n");
  const primaryRoot = typeof capsule.workspace.primaryRoot === "string"
    ? capsule.workspace.primaryRoot
    : "unavailable";
  const git = capsule.workspace.git;
  const gitRecord = git !== null && typeof git === "object"
    ? git as Record<string, unknown>
    : undefined;
  const gitRow = gitRecord === undefined
    ? []
    : [`- Git: branch=${String(gitRecord.branch ?? "unknown")}; head=${String(gitRecord.head ?? "unknown")}; dirty=${String(gitRecord.dirty ?? "unknown")}`];
  const fileRows = capsule.files.map((file) =>
    `- File: ${file.kind} ${file.path} [evidence: ${evidenceLabel(file.evidenceRefs)}]`
  );
  const workspaceRows = [`- Root: ${primaryRoot}`, ...gitRow, ...fileRows].join("\n");
  const commandRows = capsule.commands.length === 0
    ? "- None evidenced."
    : capsule.commands.map((command) => {
        const exit = command.exitCode === undefined ? "unknown" : String(command.exitCode);
        return `- Command: \`${command.command}\` (cwd: ${command.cwd}; exit: ${exit}) [evidence: ${evidenceLabel(command.evidenceRefs)}]`;
      }).join("\n");
  const validationRows = capsule.validations.length === 0
    ? "- None evidenced."
    : capsule.validations.map((validation) =>
        `- Validation: ${validation.status.toUpperCase()} ${validation.name} — ${compactText(validation.summary)} [evidence: ${evidenceLabel(validation.evidenceRefs)}]`
      ).join("\n");

  return `# AgentCarry Continuation Brief

${renderBriefSection("First action", first)}

${renderBriefSection("Forbidden before first action", forbidden)}

${renderBriefSection("Constraints", constraints)}

${renderBriefSection("Current state", currentState)}

${renderBriefSection("Later actions", later)}

## Validations
${validationRows}

## Commands already run
${commandRows}

## Transfer losses
${losses}

## Workspace
${workspaceRows}
`;
}

export function buildContinuationPrompt(capsule: WorkCapsule): string {
  return `This is a context-seeding turn for a coding task transferred from another agent.

Do not use tools, edit files, run commands, or begin the task in this seeding turn.
Reply only: AgentCarry context received.
The next interactive user turn will tell you to begin.

When that next turn arrives:

1. Start with the First action in the continuation brief.
2. Do not perform any Forbidden before first action item early.
3. Verify the current workspace and reread native instruction files referenced by path. Current workspace facts override stale transcript claims.
4. If evidence conflicts or a critical decision is unclear, ask the user before editing.
5. Do not claim hidden reasoning, prompt caches, permissions, tools, tests, or attachments transferred when the transfer losses say they did not.
6. Keep the source session unchanged.

${renderContinuationBrief(capsule)}`;
}

function seedStep(cwd: string, sessionId: string): LaunchStep {
  const args = [
    "--session-id",
    sessionId,
    "--print",
    "--output-format",
    "json",
    "--tools",
    ""
  ];
  return {
    purpose: "seed-session",
    command: "claude",
    args,
    cwd,
    stdin: "capsule-prompt",
    displayCommand: `claude --session-id ${sessionId} --print --output-format json --tools "" < capsule-prompt`
  };
}

function resumeStep(cwd: string, sessionId: string): LaunchStep {
  const startPrompt = "Continue the AgentCarry handoff now. Start with the recorded First action.";
  const args = ["--resume", sessionId, startPrompt];
  return {
    purpose: "resume-interactive",
    command: "claude",
    args,
    cwd,
    stdin: "inherit",
    displayCommand: `claude --resume ${sessionId} "${startPrompt}"`
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
  readonly #runLaunch: LaunchRunner;

  constructor(options: ClaudeTargetLauncherOptions) {
    this.#cwd = options.cwd;
    this.#createSessionId = options.createSessionId ?? randomUUID;
    this.#runCommand = options.runCommand ?? defaultCommandRunner;
    this.#runLaunch = options.runLaunch ?? defaultLaunchRunner;
  }

  async launch(prepared: PreparedTargetLaunch): Promise<TargetLaunchOutcome> {
    const [seed, resume] = prepared.steps;
    if (
      prepared.agent !== this.agent
      || prepared.steps.length !== 2
      || seed?.purpose !== "seed-session"
      || seed.stdin !== "capsule-prompt"
      || resume?.purpose !== "resume-interactive"
      || resume.stdin !== "inherit"
      || seed.cwd !== this.#cwd
      || resume.cwd !== this.#cwd
    ) {
      throw new TargetLaunchError("TARGET_LAUNCH_PLAN_INVALID", "seed-session");
    }

    let seeded: CommandResult;
    try {
      seeded = await this.#runLaunch(seed, prepared.prompt);
    } catch {
      throw new TargetLaunchError("TARGET_LAUNCH_FAILED", "seed-session");
    }
    if (seeded.exitCode !== 0) {
      throw new TargetLaunchError("TARGET_SEED_FAILED", "seed-session", seeded.exitCode);
    }

    let resumed: CommandResult;
    try {
      resumed = await this.#runLaunch(resume, undefined);
    } catch {
      throw new TargetLaunchError("TARGET_LAUNCH_FAILED", "resume-interactive");
    }
    if (resumed.exitCode !== 0) {
      throw new TargetLaunchError(
        "TARGET_INTERACTIVE_FAILED",
        "resume-interactive",
        resumed.exitCode
      );
    }

    return {
      agent: this.agent,
      targetSessionId: prepared.targetSessionId,
      completedSteps: [seed.purpose, resume.purpose]
    };
  }

  prepare(result: CapsuleBuildResult): PreparedTargetLaunch {
    const targetSessionId = this.#createSessionId();
    const continuationBrief = renderContinuationBrief(result.capsule);
    return {
      agent: this.agent,
      targetSessionId,
      capsule: result.capsule,
      capsuleJson: renderCapsuleJson(result.capsule),
      capsuleMarkdown: renderCapsuleMarkdown(result.capsule),
      continuationBrief,
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
