import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true
  })));
});

function runCli(args: readonly string[], cwd: string): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const script = fileURLToPath(new URL("../scripts/external-acceptance.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), script, ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("external acceptance CLI", () => {
  it("reports and checks records from a path with spaces and non-ASCII characters", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentcarry-acceptance-"));
    temporaryRoots.push(root);
    const cwd = join(root, "中文 workspace");
    const records = join(cwd, "验收 records");
    const report = join(cwd, "REPORT.md");
    await mkdir(records, { recursive: true });
    const template = await readFile(fileURLToPath(new URL(
      "../acceptance/external-handoff-record.template.json",
      import.meta.url
    )), "utf8");
    await writeFile(join(records, "record.json"), template, "utf8");

    const rendered = await runCli(["report", records], cwd);
    expect(rendered).toMatchObject({ code: 0, stderr: "" });
    expect(rendered.stdout).toMatch(/^# AgentCarry external handoff acceptance/);
    expect(rendered.stdout).not.toContain("PASS ");

    await writeFile(report, rendered.stdout.replaceAll("\n", "\r\n"), "utf8");
    const current = await runCli(["report", records, "--check", report], cwd);
    expect(current).toMatchObject({ code: 0, stderr: "" });
    expect(current.stdout).toContain("matches acceptance records");

    await writeFile(report, `${rendered.stdout}\nSTALE\n`, "utf8");
    const stale = await runCli(["report", records, "--check", report], cwd);
    expect(stale.code).toBe(1);
    expect(stale.stderr).toContain("STALE");
  }, 15_000);

  it("returns usage error status for an unknown command", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentcarry-acceptance-"));
    temporaryRoots.push(root);

    const result = await runCli(["unknown"], root);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Usage: external-acceptance");

    const missingPath = await runCli(["report", ".", "--check"], root);
    expect(missingPath.code).toBe(2);
    expect(missingPath.stderr).toContain("--check requires a path");
  });
});
