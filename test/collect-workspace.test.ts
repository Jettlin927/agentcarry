import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { collectWorkspaceEvidence } from "../src/workspace/collect-workspace.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout;
}

async function repository(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "agentcarry-workspace-"));
  temporaryRoots.push(parent);
  const root = join(parent, "中文 项目");
  await mkdir(join(root, "src", "nested"), { recursive: true });
  await git(parent, ["init", "-b", "main", root]);
  await git(root, ["config", "user.name", "Fixture User"]);
  await git(root, ["config", "user.email", "fixture@example.com"]);
  await writeFile(join(root, "AGENTS.md"), "Repository instructions\n", "utf8");
  await writeFile(join(root, "src", "nested", "CLAUDE.md"), "Nested instructions\n", "utf8");
  await writeFile(join(root, "src", "app.ts"), "export const value = 1;\n", "utf8");
  await writeFile(join(root, "obsolete.ts"), "old\n", "utf8");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "fixture"]);
  await writeFile(join(root, "src", "app.ts"), "export const value = 2;\n", "utf8");
  await writeFile(join(root, "src", "新文件.ts"), "export const added = true;\n", "utf8");
  await unlink(join(root, "obsolete.ts"));
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("collectWorkspaceEvidence", () => {
  it("collects current Git and instruction hashes without changing the repository", async () => {
    const root = await repository();
    const cwd = join(root, "src", "nested");
    const before = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);

    const evidence = await collectWorkspaceEvidence(cwd, {
      now: () => new Date("2026-07-21T00:00:00Z")
    });

    const after = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    expect(after).toBe(before);
    expect(evidence.workspace).toMatchObject({
      primaryRoot: root,
      capturedAt: "2026-07-21T00:00:00.000Z",
      git: { branch: "main", dirty: true }
    });
    expect(evidence.files.map((file) => [file.path, file.kind])).toEqual([
      ["obsolete.ts", "deleted"],
      ["src/app.ts", "modified"],
      ["src/新文件.ts", "created"]
    ]);
    expect(evidence.files.find((file) => file.kind === "modified")?.sha256).toHaveLength(64);
    expect(evidence.files.find((file) => file.kind === "deleted")?.sha256).toBeUndefined();
    expect(evidence.workspace.instructionFiles).toHaveLength(2);
    expect(evidence.workspace.instructionFiles.map((file) => file.scope)).toEqual([
      "repository",
      "subtree:src/nested"
    ]);
    expect(evidence.workspace.instructionFiles.every((file) => file.sha256.length === 64)).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain(await readFile(join(root, "AGENTS.md"), "utf8"));
  });

  it("returns a non-Git snapshot without inventing Git state", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentcarry-no-git-"));
    temporaryRoots.push(root);

    const evidence = await collectWorkspaceEvidence(root, {
      now: () => new Date("2026-07-21T00:00:00Z")
    });

    expect(evidence.workspace.primaryRoot).toBe(root);
    expect(evidence.workspace.git).toBeUndefined();
    expect(evidence.files).toEqual([]);
  });
});

