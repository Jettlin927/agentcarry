import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  claudeLauncherMetadata,
  defaultCommandRunner,
  type CommandRunner
} from "../adapters/claude/target-launcher.js";
import {
  codexAdapterMetadata,
  resolveCodexSessionRoot
} from "../adapters/codex/source-reader.js";
import type { SourceReader } from "../adapters/source-reader.js";
import type { TargetDiagnostic } from "../adapters/target-launcher.js";
import { agentCarryVersion } from "../cli.js";

export type CompatibilityStatus = "supported" | "degraded" | "unsupported" | "unknown";

export interface DoctorCheck {
  readonly id: "node" | "agentcarry" | "codex-cli" | "claude-cli" | "codex-reader" | "claude-launcher";
  readonly available: boolean;
  readonly version: string | null;
  readonly compatibility: CompatibilityStatus;
  readonly detail: string;
  readonly authentication?: TargetDiagnostic["authentication"];
}

export interface DoctorStorageCheck {
  readonly id: "codex-sessions" | "agentcarry-lineage";
  readonly path: string;
  readonly exists: boolean;
  readonly readable: boolean;
  readonly writable: boolean;
  readonly basis: "path" | "nearest-existing-parent" | "none";
  readonly compatibility: CompatibilityStatus;
}

export interface DoctorReport {
  readonly schemaVersion: "1.0.0";
  readonly checks: readonly DoctorCheck[];
  readonly storage: readonly DoctorStorageCheck[];
  readonly policies: {
    readonly installsAgents: false;
    readonly managesAuthentication: false;
    readonly mutatesConfiguration: false;
    readonly networkTelemetry: false;
    readonly updateCheck: false;
  };
}

export interface DoctorOptions {
  readonly codexReader: SourceReader;
  readonly diagnoseClaude: () => Promise<TargetDiagnostic>;
  readonly codexHome?: string;
  readonly agentCarryHome?: string;
  readonly userHome?: string;
  readonly runCommand?: CommandRunner;
}

function observed(version: string | null, versions: readonly string[]): boolean {
  return version !== null && versions.some((candidate) => version.includes(candidate));
}

async function commandCheck(
  id: "codex-cli",
  command: string,
  observedVersions: readonly string[],
  runner: CommandRunner
): Promise<DoctorCheck> {
  try {
    const result = await runner(command, ["--version"]);
    if (result.exitCode !== 0) {
      return {
        id,
        available: false,
        version: null,
        compatibility: "unsupported",
        detail: `${command} --version exited ${result.exitCode}`
      };
    }
    const version = result.stdout.trim() || result.stderr.trim() || null;
    return {
      id,
      available: true,
      version,
      compatibility: observed(version, observedVersions) ? "supported" : "degraded",
      detail: observed(version, observedVersions)
        ? "Version is covered by adapter verification."
        : "CLI is available, but this version has not been verified."
    };
  } catch {
    return {
      id,
      available: false,
      version: null,
      compatibility: "unsupported",
      detail: `${command} is not executable from this environment.`
    };
  }
}

async function existingAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

async function storageCheck(
  id: DoctorStorageCheck["id"],
  path: string,
  prospective: boolean
): Promise<DoctorStorageCheck> {
  const absolutePath = resolve(path);
  try {
    const metadata = await stat(absolutePath);
    const readable = metadata.isDirectory() && await existingAccess(absolutePath, constants.R_OK);
    const writable = metadata.isDirectory() && await existingAccess(absolutePath, constants.W_OK);
    return {
      id,
      path: absolutePath,
      exists: true,
      readable,
      writable,
      basis: "path",
      compatibility: (id === "codex-sessions" ? readable : writable) ? "supported" : "unsupported"
    };
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!prospective || code !== "ENOENT") {
      return {
        id,
        path: absolutePath,
        exists: false,
        readable: false,
        writable: false,
        basis: "none",
        compatibility: code === "ENOENT" || code === "EACCES" || code === "EPERM"
          ? "unsupported"
          : "unknown"
      };
    }
  }

  let parent = dirname(absolutePath);
  while (true) {
    try {
      if ((await stat(parent)).isDirectory()) {
        const writable = await existingAccess(parent, constants.W_OK);
        return {
          id,
          path: absolutePath,
          exists: false,
          readable: false,
          writable,
          basis: "nearest-existing-parent",
          compatibility: writable ? "supported" : "unsupported"
        };
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return {
          id,
          path: absolutePath,
          exists: false,
          readable: false,
          writable: false,
          basis: "none",
          compatibility: "unknown"
        };
      }
      // Continue toward the filesystem root without creating anything.
    }
    const next = dirname(parent);
    if (next === parent) {
      return {
        id,
        path: absolutePath,
        exists: false,
        readable: false,
        writable: false,
        basis: "none",
        compatibility: "unknown"
      };
    }
    parent = next;
  }
}

function claudeChecks(diagnostic: TargetDiagnostic): DoctorCheck[] {
  const versionCovered = observed(diagnostic.version, claudeLauncherMetadata.observedClaudeVersions);
  const compatibility: CompatibilityStatus = !diagnostic.available
    ? "unsupported"
    : versionCovered ? "supported" : diagnostic.version === null ? "unknown" : "degraded";
  return [
    {
      id: "claude-cli",
      available: diagnostic.available,
      version: diagnostic.version,
      compatibility,
      authentication: diagnostic.authentication,
      detail: diagnostic.available
        ? "Authentication is CLI-reported and is not a live provider request."
        : "Claude Code is not executable from this environment."
    },
    {
      id: "claude-launcher",
      available: diagnostic.available,
      version: claudeLauncherMetadata.adapterVersion,
      compatibility,
      detail: versionCovered
        ? "Dry-run and interactive launch protocol supported for this Claude Code version."
        : "Launcher compatibility is not verified for this Claude Code version."
    }
  ];
}

export async function diagnoseDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const userHome = options.userHome ?? homedir();
  const sessionPath = resolveCodexSessionRoot({
    ...(options.codexHome === undefined ? {} : { codexHome: options.codexHome }),
    userHome
  });
  const lineagePath = join(
    options.agentCarryHome ?? process.env.AGENTCARRY_HOME ?? join(userHome, ".agentcarry"),
    "lineage"
  );
  const runner = options.runCommand ?? defaultCommandRunner;
  const [codexCli, claude, sessions, lineage] = await Promise.all([
    commandCheck("codex-cli", "codex", codexAdapterMetadata.observedCodexVersions, runner),
    options.diagnoseClaude(),
    storageCheck("codex-sessions", sessionPath, false),
    storageCheck("agentcarry-lineage", lineagePath, true)
  ]);

  let sourceVersion: string | null = null;
  let readerCompatibility: CompatibilityStatus = sessions.readable ? "unknown" : "unsupported";
  if (sessions.readable) {
    try {
      const discovered = await options.codexReader.discover();
      sourceVersion = discovered.find((session) => session.agentVersion !== null)?.agentVersion ?? null;
      readerCompatibility = observed(sourceVersion, codexAdapterMetadata.observedCodexVersions)
        ? "supported"
        : sourceVersion === null ? "unknown" : "degraded";
    } catch {
      readerCompatibility = "degraded";
    }
  }

  return {
    schemaVersion: "1.0.0",
    checks: [
      {
        id: "node",
        available: true,
        version: process.version,
        compatibility: Number.parseInt(process.versions.node, 10) >= 22 ? "supported" : "unsupported",
        detail: "AgentCarry requires Node.js 22 or newer."
      },
      {
        id: "agentcarry",
        available: true,
        version: agentCarryVersion,
        compatibility: "supported",
        detail: "This is the currently executing AgentCarry build."
      },
      codexCli,
      ...claudeChecks(claude),
      {
        id: "codex-reader",
        available: sessions.readable,
        version: sourceVersion ?? codexAdapterMetadata.adapterVersion,
        compatibility: readerCompatibility,
        detail: sessions.readable
          ? "Local Codex session storage is readable; no source file was modified."
          : "Local Codex session storage is not readable."
      }
    ],
    storage: [sessions, lineage],
    policies: {
      installsAgents: false,
      managesAuthentication: false,
      mutatesConfiguration: false,
      networkTelemetry: false,
      updateCheck: false
    }
  };
}

export function renderDoctorReport(report: DoctorReport): string {
  const rows = report.checks.map((check) => {
    const version = check.version ?? "—";
    const auth = check.authentication === undefined ? "" : `; auth=${check.authentication}`;
    return `${check.id.padEnd(16)} ${check.compatibility.padEnd(11)} ${version}${auth}`;
  });
  const storage = report.storage.map((check) => {
    const access = check.id === "codex-sessions"
      ? `readable=${check.readable}`
      : `writable=${check.writable}`;
    return `${check.id.padEnd(18)} ${check.compatibility.padEnd(11)} ${access} ${check.path} (${check.basis})`;
  });
  return [
    "AgentCarry doctor",
    "",
    ...rows,
    "",
    ...storage,
    "",
    "Read-only: no installs, login, config writes, telemetry, or update checks."
  ].join("\n");
}
