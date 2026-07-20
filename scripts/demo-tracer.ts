import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sessionId = "00000000-0000-4000-8000-000000000001";

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function runCli(codexHome: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      join(process.cwd(), "dist", "cli-main.js"),
      "continue",
      "--to",
      "claude",
      "--dry-run",
      "--json"
    ], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_HOME: codexHome },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8") || `AgentCarry exited ${exitCode}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "agentcarry-tracer-"));
try {
  const codexHome = join(temporaryRoot, ".codex");
  const sessionDirectory = join(codexHome, "sessions", "2026", "07", "21");
  const sessionPath = join(sessionDirectory, `rollout-${sessionId}.jsonl`);
  await mkdir(sessionDirectory, { recursive: true });
  const envelopes = [
    {
      timestamp: "2026-07-21T00:00:00Z",
      type: "session_meta",
      payload: {
        id: sessionId,
        cwd: process.cwd(),
        cli_version: "0.145.0-alpha.18",
        source: "vscode",
        thread_source: "user"
      }
    },
    { timestamp: "2026-07-21T00:00:01Z", type: "event_msg", payload: { type: "task_started" } },
    {
      timestamp: "2026-07-21T00:00:02Z",
      type: "event_msg",
      payload: { type: "user_message", message: "Fix the parser without changing exports." }
    },
    {
      timestamp: "2026-07-21T00:00:03Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        id: "tool-1",
        call_id: "call-1",
        name: "exec_command",
        input: { cmd: "npm test" }
      }
    },
    {
      timestamp: "2026-07-21T00:00:04Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        id: "tool-output-1",
        call_id: "call-1",
        output: "1 test failed"
      }
    },
    {
      timestamp: "2026-07-21T00:00:05Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "The parser is modified; the focused test is pending." }
    },
    { timestamp: "2026-07-21T00:00:06Z", type: "event_msg", payload: { type: "task_complete" } }
  ];
  await writeFile(sessionPath, `${envelopes.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

  const before = sha256(await readFile(sessionPath));
  const output = JSON.parse(await runCli(codexHome)) as {
    ok: boolean;
    data: {
      capsule: { source: { sessionId: string }; evidenceRefs: unknown[] };
      lossReceipt: { canContinue: boolean; losses: Array<{ code: string }> };
      steps: Array<{ displayCommand: string }>;
      prerequisitesVerified: boolean;
    };
  };
  const after = sha256(await readFile(sessionPath));
  if (!output.ok || output.data.capsule.source.sessionId !== sessionId || before !== after) {
    throw new Error("Tracer verification failed");
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    selectedCurrentWorkspaceSession: output.data.capsule.source.sessionId,
    evidenceRefs: output.data.capsule.evidenceRefs.length,
    lossCodes: output.data.lossReceipt.losses.map((loss) => loss.code),
    canContinue: output.data.lossReceipt.canContinue,
    targetSteps: output.data.steps.map((step) => step.displayCommand),
    prerequisitesVerified: output.data.prerequisitesVerified,
    sourceHashUnchanged: true,
    claudeProcessStarted: false
  }, null, 2)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
