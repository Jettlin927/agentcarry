import { createHash } from "node:crypto";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function waitForCheckpointReadiness(
  child: ChildProcess,
  getStderr: () => string,
  timeoutMs: number
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timeout: NodeJS.Timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
      child.stderr?.off("data", onStderr);
    };
    const rejectAfterClose = (error: Error, terminate: boolean) => {
      cleanup();
      child.once("close", () => reject(error));
      if (terminate) child.kill();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => rejectAfterClose(new Error(
      `checkpoint process exited before readiness with ${code}: ${getStderr()}`
    ), false);
    const onStderr = () => {
      if (getStderr().includes("CHECKPOINT_STDIN_READY")) {
        cleanup();
        resolve();
      }
    };

    child.once("error", onError);
    child.once("exit", onExit);
    child.stderr?.on("data", onStderr);
    timeout = setTimeout(() => rejectAfterClose(new Error(
      `checkpoint readiness timed out: ${getStderr()}`
    ), true), timeoutMs);
  });
}

function waitForClose(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => {
    await rm(root, { recursive: true, force: true });
  }));
});

describe("active Codex to Claude tracer bullet", () => {
  it("terminates a stalled checkpoint process after the readiness timeout", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    child.stderr?.setEncoding("utf8");
    let stderr = "";
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });

    await expect(waitForCheckpointReadiness(child, () => stderr, 50)).rejects.toThrow(
      "checkpoint readiness timed out"
    );
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it("hands off one active checkpoint through stdin and leaves the source unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentcarry-active-tracer-"));
    temporaryRoots.push(root);
    const workspace = join(root, "中文 workspace");
    const codexHome = join(root, ".codex");
    const sessions = join(codexHome, "sessions");
    const sourcePath = join(sessions, "active.jsonl");
    await mkdir(workspace, { recursive: true });
    await mkdir(sessions, { recursive: true });
    const currentUserMessage = "把当前任务和所有关键上下文交给 Claude Code 继续。";
    const nativeEvents = [
      {
        timestamp: "2026-07-21T00:00:00Z",
        type: "session_meta",
        payload: {
          id: "active-tracer-session",
          cwd: workspace,
          cli_version: "0.145.0-alpha.18",
          source: "vscode",
          thread_source: "user"
        }
      },
      {
        timestamp: "2026-07-21T00:00:01Z",
        type: "event_msg",
        payload: { type: "task_started" }
      },
      {
        timestamp: "2026-07-21T00:00:02Z",
        type: "event_msg",
        payload: { type: "user_message", message: currentUserMessage }
      }
    ];
    await writeFile(
      sourcePath,
      `${nativeEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8"
    );
    const before = sha256(await readFile(sourcePath));
    const entrypoint = fileURLToPath(new URL("../src/cli-main.ts", import.meta.url));
    const tsxLoader = import.meta.resolve("tsx");
    const child = spawn(process.execPath, [
      "--import",
      tsxLoader,
      entrypoint,
      "continue",
      "--to",
      "claude",
      "--active",
      "--checkpoint-stdin",
      "--dry-run",
      "--json"
    ], {
      cwd: workspace,
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const closed = waitForClose(child);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const ready = waitForCheckpointReadiness(child, () => stderr, 30_000);

    try {
      await ready;
      child.stdin.end(`${JSON.stringify({
        schemaVersion: "1.0.0",
        currentUserMessage,
        assistantCheckpoint: "已完成 active snapshot 与 stdin 协议。下一步运行三平台 CI。"
      })}\n`, "utf8");
      const exitCode = await closed;
      const envelope = JSON.parse(stdout) as {
        ok: boolean;
        data: {
          capsule: {
            currentUserMessage: { text: string };
            source: { snapshot: { sha256: string } };
            losses: Array<{ code: string }>;
          };
        };
      };

      expect(exitCode).toBe(0);
      expect(envelope.ok).toBe(true);
      expect(envelope.data.capsule.currentUserMessage.text).toBe(currentUserMessage);
      expect(envelope.data.capsule.source.snapshot.sha256).toBe(before);
      expect(envelope.data.capsule.losses.map((loss) => loss.code)).toEqual(expect.arrayContaining([
        "SOURCE_AGENT_CHECKPOINT",
        "NATIVE_PARTIAL_ASSISTANT_OUTPUT_EXCLUDED"
      ]));
      expect(sha256(await readFile(sourcePath))).toBe(before);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await closed;
      }
    }
  }, 40_000);
});
