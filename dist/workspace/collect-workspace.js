import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
export const defaultGitCommandRunner = async (args, cwd) => await new Promise((resolveResult, reject) => {
    const child = spawn("git", args, {
        cwd,
        env: process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => resolveResult({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
    }));
});
async function sha256(path) {
    return await new Promise((resolveHash, reject) => {
        const hash = createHash("sha256");
        createReadStream(path)
            .on("data", (chunk) => hash.update(chunk))
            .on("error", reject)
            .on("end", () => resolveHash(hash.digest("hex")));
    });
}
async function existingFile(path) {
    try {
        await access(path);
        return (await stat(path)).isFile();
    }
    catch {
        return false;
    }
}
function directoriesFromRoot(repoRoot, cwd) {
    const directories = [];
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
async function instructionFiles(repoRoot, cwd) {
    const result = [];
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
function statusKind(status) {
    if (status === "??" || status.includes("A")) {
        return "created";
    }
    if (status.includes("D")) {
        return "deleted";
    }
    return "modified";
}
async function statusFiles(repoRoot, output) {
    const fields = output.split("\0").filter((field) => field.length > 0);
    const files = [];
    for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
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
    return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
async function successfulOutput(runner, cwd, args) {
    const result = await runner(args, cwd);
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
}
export async function collectWorkspaceEvidence(cwd, options = {}) {
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
    const prefix = await successfulOutput(runGit, absoluteCwd, ["rev-parse", "--show-prefix"]);
    const canonicalCwd = prefix === undefined
        ? absoluteRepoRoot
        : resolve(absoluteRepoRoot, prefix);
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
            instructionFiles: await instructionFiles(absoluteRepoRoot, canonicalCwd)
        },
        files
    };
}
