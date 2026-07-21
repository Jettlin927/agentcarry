import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HandoffInputArtifact } from "./build-handoff-input.js";
import { totalInputTokens, type ClaudeUsage } from "./claude-usage.js";
import {
  defaultProcessRunner,
  type ProcessRunner
} from "./run-source-assisted.js";

const systemPrompt = `You are evaluating a coding-task handoff.
Use only the supplied handoff input. Do not use tools, inspect files, or invent state.
Return a concise continuation brief that states the objective, critical constraints,
current state, decisions, failed attempts, completed work, pending work, and the
single correct next action. Do not perform that action or claim new validation.`;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export type TargetSettingSources = "none" | "user";

export interface TargetSettings {
  readonly permissionMode: "plan";
  readonly maxTurns: 1;
  readonly tools: "disabled";
  readonly persistence: "disabled";
  readonly slashCommands: "disabled";
  readonly mcp: "empty-strict";
  readonly settingSources: TargetSettingSources;
  readonly systemPromptSha256: string;
}

export function createTargetSettings(
  settingSources: TargetSettingSources = "none"
): TargetSettings {
  return {
    permissionMode: "plan",
    maxTurns: 1,
    tools: "disabled",
    persistence: "disabled",
    slashCommands: "disabled",
    mcp: "empty-strict",
    settingSources,
    systemPromptSha256: sha256(systemPrompt)
  };
}

export const targetSettings = createTargetSettings();

export interface TargetInvocation {
  readonly command: "claude";
  readonly args: readonly string[];
  readonly stdin: string;
  readonly model: string;
  readonly settings: TargetSettings;
}

export interface TargetRunResult {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly fixtureId: string;
  readonly mode: HandoffInputArtifact["mode"];
  readonly sourceFingerprint: string;
  readonly target: {
    readonly agent: "claude";
    readonly model: string;
    readonly provider: string;
    readonly settings: TargetSettings;
  };
  readonly input: {
    readonly sha256: string;
    readonly utf8Bytes: number;
    readonly exactTargetInputTokens: number;
  };
  readonly output: {
    readonly text: string;
    readonly sha256: string;
  };
  readonly invocation: {
    readonly promptSha256: string;
    readonly startedAt: string;
    readonly completedAt: string;
  };
}

interface ClaudeEnvelope {
  readonly result?: string;
  readonly is_error?: boolean;
  readonly usage?: ClaudeUsage;
}

function targetPrompt(artifact: HandoffInputArtifact): string {
  return `Continue from this handoff input. Preserve qualifiers and explicitly avoid recorded failed paths.

HANDOFF INPUT (${artifact.contentType})
${artifact.content}`;
}

export function createTargetInvocation(
  artifact: HandoffInputArtifact,
  model: string,
  options: { readonly settingSources?: TargetSettingSources } = {}
): TargetInvocation {
  if (model.trim().length === 0) {
    throw new Error("target model must be explicit and non-empty");
  }
  const settings = createTargetSettings(options.settingSources);
  return {
    command: "claude",
    args: [
      "--print",
      "--no-session-persistence",
      "--tools",
      "",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--mcp-config",
      "{\"mcpServers\":{}}",
      "--permission-mode",
      "plan",
      "--setting-sources",
      settings.settingSources === "none" ? "" : settings.settingSources,
      "--max-turns",
      "1",
      "--system-prompt",
      systemPrompt,
      "--output-format",
      "json",
      "--model",
      model
    ],
    stdin: targetPrompt(artifact),
    model,
    settings
  };
}

export async function runTargetContinuation(
  artifact: HandoffInputArtifact,
  model: string,
  options: {
    readonly runner?: ProcessRunner;
    readonly now?: () => Date;
    readonly provider?: string;
    readonly settingSources?: TargetSettingSources;
  } = {}
): Promise<TargetRunResult> {
  const invocation = createTargetInvocation(artifact, model, options);
  const runner = options.runner ?? defaultProcessRunner;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "agentcarry-target-run-"));
  try {
    const processResult = await runner(invocation.command, invocation.args, {
      cwd: temporaryDirectory,
      stdin: invocation.stdin
    });
    if (processResult.exitCode !== 0) {
      const details = processResult.stderr.trim()
        || processResult.stdout.trim()
        || `exit code ${processResult.exitCode}`;
      throw new Error(`target continuation failed (${processResult.exitCode}): ${details}`);
    }
    const envelope = JSON.parse(processResult.stdout) as ClaudeEnvelope;
    if (
      envelope.is_error === true
      || envelope.result === undefined
      || envelope.result.trim().length === 0
    ) {
      throw new Error("target continuation returned no successful result text");
    }
    return {
      schemaVersion: "1.0.0",
      runId: `${artifact.fixtureId}:${artifact.mode}:initial`,
      fixtureId: artifact.fixtureId,
      mode: artifact.mode,
      sourceFingerprint: artifact.sourceFingerprint,
      target: {
        agent: "claude",
        model,
        provider: options.provider ?? "unspecified",
        settings: invocation.settings
      },
      input: {
        sha256: sha256(invocation.stdin),
        utf8Bytes: Buffer.byteLength(invocation.stdin, "utf8"),
        exactTargetInputTokens: totalInputTokens(envelope.usage)
      },
      output: {
        text: envelope.result,
        sha256: sha256(envelope.result)
      },
      invocation: {
        promptSha256: sha256(invocation.stdin),
        startedAt,
        completedAt: now().toISOString()
      }
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
