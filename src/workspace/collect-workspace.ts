import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface GitCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitCommandRunner = (
  args: readonly string[],
  cwd: string
) => Promise<GitCommandResult>;

export interface WorkspaceFileEvidence {
  readonly path: string;
  readonly kind: "modified" | "created" | "deleted" | "referenced";
  readonly sha256?: string;
  readonly evidenceRefs: readonly string[];
}

export interface CollectedWorkspaceEvidence {
  readonly workspace: {
    readonly primaryRoot: string;
    readonly additionalRoots: readonly string[];
    readonly capturedAt: string;
    readonly git?: {
      readonly repoRoot: string;
      readonly branch?: string;
      readonly head?: string;
      readonly base?: string;
      readonly dirty: boolean;
    };
    readonly instructionFiles: ReadonlyArray<{
      readonly path: string;
      readonly sha256: string;
      readonly scope: string;
    }>;
  };
  readonly files: readonly WorkspaceFileEvidence[];
}

export interface CollectWorkspaceOptions {
  readonly now?: () => Date;
  readonly runGit?: GitCommandRunner;
}

export const defaultGitCommandRunner: GitCommandRunner = async (args, cwd) =>
  await new Promise((resolveResult, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => resolveResult({
      exitCode: exitCode ?? 1,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8")
    }));
  });

async function sha256(path: string): Promise<string> {
  return await new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function existingFile(path: string): Promise<boolean> {
  try {
    await access(path);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function directoriesFromRoot(repoRoot: string, cwd: string): string[] {
  const directories: string[] = [];
  let current = resolve(cwd);
  const root = resolve(repoRoot);
  while (true) {
    directories.push(current);
    if (current === root) {
      break;
    }
    const parent = dirname(current);
    if (parent === current || relative(root, parent).startsWith("..")) {
      return [root];
    }
    current = parent;
  }
  return directories.reverse();
}

async function instructionFiles(repoRoot: string, cwd: string): Promise<CollectedWorkspaceEvidence["workspace"]["instructionFiles"]> {
  const result: Array<{ path: string; sha256: string; scope: string }> = [];
  for (const directory of directoriesFromRoot(repoRoot, cwd)) {
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const path = join(directory, name);
      if (await existingFile(path)) {
        const directoryScope = relative(repoRoot, directory).replaceAll("\\", "/");
        result.push({
          path,
          sha256: await sha256(path),
          scope: directoryScope.length === 0 ? "repository" : `subtree:${directoryScope}`
        });
      }
    }
  }
  return result;
}

function statusKind(status: string): WorkspaceFileEvidence["kind"] {
  if (status === "??" || status.includes("A")) {
    return "created";
  }
  if (status.includes("D")) {
    return "deleted";
  }
  return "modified";
}

async function statusFiles(repoRoot: string, output: string): Promise<WorkspaceFileEvidence[]> {
  const fields = output.split("\0").filter((field) => field.length > 0);
  const files: WorkspaceFileEvidence[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    const status = field.slice(0, 2);
    const relativePath = field.slice(3);
    if (status.includes("R") || status.includes("C")) {
      index += 1;
    }
    const absolutePath = isAbsolute(relativePath) ? relativePath : join(repoRoot, relativePath);
    const kind = statusKind(status);
    const canHash = kind !== "deleted" && await existingFile(absolutePath);
    files.push({
      path: relativePath.replaceAll("\\", "/"),
      kind,
      ...(canHash ? { sha256: await sha256(absolutePath) } : {}),
      evidenceRefs: ["workspace:git-status"]
    });
  }
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
}

async function successfulOutput(
  runner: GitCommandRunner,
  cwd: string,
  args: readonly string[]
): Promise<string | undefined> {
  const result = await runner(args, cwd);
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

export async function collectWorkspaceEvidence(
  cwd: string,
  options: CollectWorkspaceOptions = {}
): Promise<CollectedWorkspaceEvidence> {
  const runGit = options.runGit ?? defaultGitCommandRunner;
  const capturedAt = (options.now ?? (() => new Date()))().toISOString();
  const absoluteCwd = resolve(cwd);
  const repoRoot = await successfulOutput(runGit, absoluteCwd, ["rev-parse", "--show-toplevel"]);
  if (repoRoot === undefined) {
    return {
      workspace: {
        primaryRoot: absoluteCwd,
        additionalRoots: [],
        capturedAt,
        instructionFiles: []
      },
      files: []
    };
  }
  const absoluteRepoRoot = resolve(repoRoot);

  const branch = await successfulOutput(runGit, absoluteRepoRoot, ["branch", "--show-current"]);
  const head = await successfulOutput(runGit, absoluteRepoRoot, ["rev-parse", "HEAD"]);
  const upstream = await successfulOutput(runGit, absoluteRepoRoot, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}"
  ]);
  const base = upstream === undefined
    ? undefined
    : await successfulOutput(runGit, absoluteRepoRoot, ["merge-base", "HEAD", upstream]);
  const statusResult = await runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], absoluteRepoRoot);
  if (statusResult.exitCode !== 0) {
    throw new Error(`git status failed: ${statusResult.stderr.trim()}`);
  }
  const files = await statusFiles(absoluteRepoRoot, statusResult.stdout);

  return {
    workspace: {
      primaryRoot: absoluteRepoRoot,
      additionalRoots: [],
      capturedAt,
      git: {
        repoRoot: absoluteRepoRoot,
        ...(branch === undefined || branch.length === 0 ? {} : { branch }),
        ...(head === undefined ? {} : { head }),
        ...(base === undefined ? {} : { base }),
        dirty: files.length > 0
      },
      instructionFiles: await instructionFiles(absoluteRepoRoot, absoluteCwd)
    },
    files
  };
}
