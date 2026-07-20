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
  model: string
): Promise<SourceAssistedInvocation> {
  const schemaPath = fileURLToPath(
    new URL("../../schema/work-capsule.v1.schema.json", import.meta.url)
  );
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
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
    tools: "disabled"
  };
}

interface ClaudeEnvelope {
  readonly structured_output?: unknown;
  readonly result?: string;
  readonly usage?: { readonly input_tokens?: number };
}

export async function runSourceAssisted(
  fixture: BenchmarkSourceFixture,
  model: string,
  runner: ProcessRunner = defaultProcessRunner
): Promise<HandoffInputArtifact> {
  const invocation = await createSourceAssistedInvocation(fixture, model);
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
    const inputTokens = envelope.usage?.input_tokens;
    if (capsule === undefined) {
      throw new Error("source-assisted summarizer returned no structured output");
    }
    if (inputTokens === undefined) {
      throw new Error("source-assisted summarizer returned no input token count");
    }
    return sourceAssistedArtifact(fixture, model, capsule, inputTokens);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
