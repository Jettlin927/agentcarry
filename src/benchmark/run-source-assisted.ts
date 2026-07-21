import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSourceAssistedPrompt,
  sourceAssistedArtifact,
  type BenchmarkSourceFixture,
  type HandoffInputArtifact
} from "./build-handoff-input.js";
import { totalInputTokens, type ClaudeUsage } from "./claude-usage.js";
import type { TargetSettingSources } from "./run-target-continuation.js";

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly stdin: string }
) => Promise<ProcessResult>;

export interface SourceAssistedInvocation {
  readonly command: "claude";
  readonly args: readonly string[];
  readonly stdin: string;
  readonly model: string;
  readonly persistence: "disabled";
  readonly tools: "disabled";
  readonly settingSources: TargetSettingSources;
}

export async function defaultProcessRunner(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly stdin: string }
): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
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
    child.stdin.end(options.stdin, "utf8");
  });
}

export async function createSourceAssistedInvocation(
  fixture: BenchmarkSourceFixture,
  model: string,
  options: { readonly settingSources?: TargetSettingSources } = {}
): Promise<SourceAssistedInvocation> {
  const schemaPath = fileURLToPath(
    new URL("../../schema/work-capsule.v1.schema.json", import.meta.url)
  );
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
  const settingSources = options.settingSources ?? "none";
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
      settingSources === "none" ? "" : settingSources,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(schema),
      "--model",
      model
    ],
    stdin: buildSourceAssistedPrompt(fixture),
    model,
    persistence: "disabled",
    tools: "disabled",
    settingSources
  };
}

interface ClaudeEnvelope {
  readonly structured_output?: unknown;
  readonly result?: string;
  readonly usage?: ClaudeUsage;
}

export async function runSourceAssisted(
  fixture: BenchmarkSourceFixture,
  model: string,
  runner: ProcessRunner = defaultProcessRunner,
  options: { readonly settingSources?: TargetSettingSources } = {}
): Promise<HandoffInputArtifact> {
  const invocation = await createSourceAssistedInvocation(fixture, model, options);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "agentcarry-benchmark-"));
  try {
    const result = await runner(invocation.command, invocation.args, {
      cwd: temporaryDirectory,
      stdin: invocation.stdin
    });
    if (result.exitCode !== 0) {
      const details = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
      throw new Error(`source-assisted summarizer failed (${result.exitCode}): ${details}`);
    }
    const envelope = JSON.parse(result.stdout) as ClaudeEnvelope;
    const capsule = envelope.structured_output
      ?? (envelope.result === undefined ? undefined : JSON.parse(envelope.result));
    const inputTokens = totalInputTokens(envelope.usage);
    if (capsule === undefined) {
      throw new Error("source-assisted summarizer returned no structured output");
    }
    return sourceAssistedArtifact(fixture, model, capsule, inputTokens);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
