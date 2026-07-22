import type { CapsuleBuildResult, WorkCapsule } from "../capsule/build-capsule.js";

export interface TargetDiagnostic {
  readonly agent: string;
  readonly available: boolean;
  readonly version: string | null;
  readonly authentication: "reported-authenticated" | "reported-missing" | "unknown";
  readonly details: readonly string[];
}

export interface LaunchStep {
  readonly purpose: "seed-session" | "resume-interactive";
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdin: "capsule-prompt" | "inherit";
  readonly displayCommand: string;
}

export interface PreparedTargetLaunch {
  readonly agent: string;
  readonly targetSessionId: string;
  readonly capsule: WorkCapsule;
  readonly capsuleJson: string;
  readonly capsuleMarkdown: string;
  readonly continuationBrief: string;
  readonly lossReceipt: CapsuleBuildResult["receipt"];
  readonly prompt: string;
  readonly steps: readonly LaunchStep[];
  readonly prerequisitesVerified: false;
}

export interface TargetLauncher {
  readonly agent: string;
  prepare(capsule: CapsuleBuildResult): PreparedTargetLaunch;
  diagnose(): Promise<TargetDiagnostic>;
}

