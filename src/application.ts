import { ClaudeTargetLauncher } from "./adapters/claude/target-launcher.js";
import { CodexSourceReader } from "./adapters/codex/source-reader.js";
import {
  SourceSelectionError,
  type CanonicalSourceEvent,
  type SourceReader,
  type SourceSession
} from "./adapters/source-reader.js";
import type { PreparedTargetLaunch, TargetLauncher } from "./adapters/target-launcher.js";
import {
  CapsuleBuildError,
  buildWorkCapsule
} from "./capsule/build-capsule.js";
import {
  ExitCode,
  type CliHandlers,
  type CommandFailure,
  type CommandResult,
  type ContinueOptions
} from "./cli.js";
import {
  collectWorkspaceEvidence,
  type CollectedWorkspaceEvidence
} from "./workspace/collect-workspace.js";

type WorkspaceCollector = (cwd: string) => Promise<CollectedWorkspaceEvidence>;
type ClaudeLauncherFactory = (cwd: string) => Pick<TargetLauncher, "prepare" | "diagnose">;

export interface AgentCarryHandlerOptions {
  readonly cwd?: string;
  readonly codexReader?: SourceReader;
  readonly collectWorkspace?: WorkspaceCollector;
  readonly createClaudeLauncher?: ClaudeLauncherFactory;
}

function failure(
  exitCode: CommandFailure["exitCode"],
  code: string,
  message: string,
  details?: unknown
): CommandFailure {
  return {
    ok: false,
    exitCode,
    code,
    message,
    ...(details === undefined ? {} : { details })
  };
}

async function eventsFrom(reader: SourceReader, session: SourceSession): Promise<CanonicalSourceEvent[]> {
  const events: CanonicalSourceEvent[] = [];
  for await (const event of reader.events(session)) {
    events.push(event);
  }
  return events;
}

function preparationFailure(error: unknown): CommandFailure {
  if (error instanceof SourceSelectionError) {
    return failure(ExitCode.source, error.code, error.message, {
      candidates: error.candidates.map(({ id, modifiedAt, activity }) => ({ id, modifiedAt, activity }))
    });
  }
  if (error instanceof CapsuleBuildError) {
    return failure(ExitCode.source, error.code, error.message);
  }
  return failure(
    ExitCode.source,
    "SOURCE_PREPARATION_FAILED",
    error instanceof Error ? error.message : String(error)
  );
}

export function createAgentCarryHandlers(options: AgentCarryHandlerOptions = {}): CliHandlers {
  const cwd = options.cwd ?? process.cwd();
  const codexReader = options.codexReader ?? new CodexSourceReader();
  const collectWorkspace = options.collectWorkspace ?? collectWorkspaceEvidence;
  const createClaudeLauncher = options.createClaudeLauncher
    ?? ((targetCwd: string) => new ClaudeTargetLauncher({ cwd: targetCwd }));

  return {
    async inspect() {
      return failure(
        ExitCode.source,
        "INSPECT_NOT_IMPLEMENTED",
        "Inspect will be connected after the first continuation tracer bullet."
      );
    },

    async prepareContinue(continueOptions: ContinueOptions): Promise<CommandResult> {
      const source = continueOptions.source ?? "codex";
      if (source !== "codex") {
        return failure(ExitCode.source, "UNSUPPORTED_SOURCE", `source agent ${source} is not supported yet`);
      }
      if (continueOptions.target !== "claude") {
        return failure(
          ExitCode.target,
          "UNSUPPORTED_TARGET",
          `target agent ${continueOptions.target} is not supported yet`
        );
      }

      try {
        const session = await codexReader.select({
          cwd,
          ...(continueOptions.session === undefined
            ? {}
            : { explicitSessionId: continueOptions.session })
        });
        const [events, workspace] = await Promise.all([
          eventsFrom(codexReader, session),
          collectWorkspace(session.cwd)
        ]);
        const result = buildWorkCapsule(session, events, workspace, {
          force: continueOptions.force
        });
        if (!result.receipt.canContinue) {
          return failure(
            ExitCode.criticalLoss,
            "CRITICAL_TRANSFER_LOSS",
            "Critical transfer loss stopped the handoff; review the loss receipt or retry once with --force.",
            { capsule: result.capsule, lossReceipt: result.receipt }
          );
        }
        const prepared: PreparedTargetLaunch = createClaudeLauncher(
          workspace.workspace.primaryRoot
        ).prepare(result);
        return { ok: true, data: prepared };
      } catch (error: unknown) {
        return preparationFailure(error);
      }
    },

    async launchContinue() {
      return failure(
        ExitCode.target,
        "TARGET_LAUNCH_NOT_IMPLEMENTED",
        "This build supports Claude dry-run preparation only."
      );
    },

    async doctor() {
      const diagnostic = await createClaudeLauncher(cwd).diagnose();
      return {
        ok: true,
        data: {
          checks: [diagnostic],
          installsAgents: false,
          managesAuthentication: false,
          telemetry: false,
          updateCheck: false
        }
      };
    }
  };
}
