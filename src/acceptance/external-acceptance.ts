import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { scanSensitive } from "../security/redact.js";

export type ExternalAcceptanceOs = "windows" | "macos";
export type ExternalHandoffOutcome = "continued" | "blocked";

export interface ExternalHandoffRecord {
  readonly schemaVersion: "1.0.0";
  readonly attemptId: string;
  readonly recordedAt: string;
  readonly participant: {
    readonly githubHandle: string;
    readonly nonAuthorAtAttempt: true;
    readonly evidenceUrl: string;
    readonly consentToPublish: true;
  };
  readonly environment: {
    readonly os: ExternalAcceptanceOs;
    readonly osVersion: string;
    readonly architecture: "x64" | "arm64";
    readonly nodeVersion: string;
    readonly agentCarryVersion: "0.1.0-acceptance.1";
    readonly agentCarryCommit: string;
    readonly codexVersion: string;
    readonly claudeCodeVersion: string;
  };
  readonly attempt: {
    readonly sourceState: "idle" | "active";
    readonly selection: "automatic" | "explicit-session";
    readonly outcome: ExternalHandoffOutcome;
    readonly targetSessionCreated: boolean;
    readonly firstActionStarted: boolean;
    readonly manualSupplement: {
      readonly required: boolean;
      readonly categories: readonly string[];
    };
    readonly lossCodes: readonly string[];
    readonly blockers: ReadonlyArray<{
      readonly code: string;
      readonly phase: string;
      readonly followUpIssueUrl: string;
    }>;
  };
  readonly timing: {
    readonly commandStartedAt: string;
    readonly outcomeRecordedAt: string;
    readonly secondsToOutcome: number;
    readonly secondsToContinuation: number | null;
  };
  readonly review: {
    readonly reviewedBy: "Jettlin927";
    readonly reviewedAt: string;
    readonly evidenceAuthorMatchesParticipant: true;
    readonly nonAuthorHistoryChecked: true;
    readonly privacyReviewPassed: true;
  };
  readonly privacy: {
    readonly noSecrets: true;
    readonly noPrivateTranscript: true;
    readonly noUnredactedSourceFile: true;
  };
}

export interface ExternalAcceptanceValidationError {
  readonly code: "SCHEMA" | "SENSITIVE_VALUE" | "TIMING" | "EVIDENCE";
  readonly location: string;
  readonly message: string;
}

export interface ExternalAcceptanceValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ExternalAcceptanceValidationError[];
}

export interface ExternalAcceptanceReport {
  readonly schemaVersion: "1.0.0";
  readonly distinctParticipants: number;
  readonly attempts: number;
  readonly continued: number;
  readonly blocked: number;
  readonly continuationRate: number;
  readonly manualSupplementAttempts: number;
  readonly reviewedRecords: number;
  readonly medianSecondsToContinuation: number | null;
  readonly platformCounts: Readonly<Record<ExternalAcceptanceOs, number>>;
  readonly manualSupplementCategories: ReadonlyArray<{
    readonly code: string;
    readonly attempts: number;
  }>;
  readonly lossCodes: ReadonlyArray<{ readonly code: string; readonly attempts: number }>;
  readonly blockers: ReadonlyArray<{ readonly code: string; readonly attempts: number }>;
  readonly cohortReady: boolean;
  readonly records: ReadonlyArray<{
    readonly participant: string;
    readonly evidenceUrl: string;
    readonly os: ExternalAcceptanceOs;
    readonly outcome: ExternalHandoffOutcome;
    readonly secondsToContinuation: number | null;
    readonly manualSupplementRequired: boolean;
    readonly lossCodes: readonly string[];
    readonly blockerCodes: readonly string[];
    readonly failureIssueUrls: readonly string[];
  }>;
}

const schemaPath = fileURLToPath(
  new URL("../../schema/external-handoff-record.v1.schema.json", import.meta.url)
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
const ajv = new Ajv2020({ allErrors: true, strict: true });
(formatsPlugin as unknown as (instance: Ajv2020) => void)(ajv);
const validateSchema = ajv.compile(schema);

function schemaError(error: ErrorObject): ExternalAcceptanceValidationError {
  return {
    code: "SCHEMA",
    location: error.instancePath || "/",
    message: error.message ?? error.keyword
  };
}

function validateTiming(record: ExternalHandoffRecord): ExternalAcceptanceValidationError[] {
  const start = Date.parse(record.timing.commandStartedAt);
  const end = Date.parse(record.timing.outcomeRecordedAt);
  const expectedSeconds = Math.round((end - start) / 1_000);
  const errors: ExternalAcceptanceValidationError[] = [];
  if (expectedSeconds < 0 || expectedSeconds !== record.timing.secondsToOutcome) {
    errors.push({
      code: "TIMING",
      location: "/timing/secondsToOutcome",
      message: "must equal the elapsed whole seconds between commandStartedAt and outcomeRecordedAt"
    });
  }
  if (
    record.attempt.outcome === "continued"
    && record.timing.secondsToContinuation !== record.timing.secondsToOutcome
  ) {
    errors.push({
      code: "TIMING",
      location: "/timing/secondsToContinuation",
      message: "must equal secondsToOutcome when the outcome is continued"
    });
  }
  return errors;
}

const publicationRiskPatterns = [
  { code: "EMAIL_ADDRESS", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  {
    code: "PRIVATE_LOCAL_PATH",
    pattern: /(?:\b[A-Z]:[\\/][^\s]+|\\\\[^\\/\s]+[\\/][^\s]+|(?:^|\s)\/[^/\s][^\s]*|~[\\/])/i
  }
] as const;

function publicationRisks(
  value: unknown,
  location = ""
): ExternalAcceptanceValidationError[] {
  if (typeof value === "string") {
    return publicationRiskPatterns
      .filter((candidate) => candidate.pattern.test(value))
      .map((candidate) => ({
        code: "SENSITIVE_VALUE" as const,
        location: location || "/",
        message: `matched ${candidate.code}`
      }));
  }
  if (Array.isArray(value)) {
    return value.flatMap((nested, index) => publicationRisks(nested, `${location}/${index}`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => publicationRisks(
      nested,
      `${location}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`
    ));
  }
  return [];
}

function validateEvidence(record: ExternalHandoffRecord): ExternalAcceptanceValidationError[] {
  const errors: ExternalAcceptanceValidationError[] = [];
  if (record.review.reviewedBy.toLowerCase() === record.participant.githubHandle.toLowerCase()) {
    errors.push({
      code: "EVIDENCE",
      location: "/review/reviewedBy",
      message: "must identify a maintainer other than the participant"
    });
  }
  const evidenceIssue = record.participant.evidenceUrl.split("#", 1)[0];
  record.attempt.blockers.forEach((blocker, index) => {
    if (blocker.followUpIssueUrl === evidenceIssue) {
      errors.push({
        code: "EVIDENCE",
        location: `/attempt/blockers/${index}/followUpIssueUrl`,
        message: "must link a separate follow-up Issue for the failure mode"
      });
    }
  });
  return errors;
}

export function validateExternalHandoffRecord(
  value: unknown
): ExternalAcceptanceValidationResult {
  const validSchema = validateSchema(value);
  const errors: ExternalAcceptanceValidationError[] = validSchema
    ? [
        ...validateTiming(value as ExternalHandoffRecord),
        ...validateEvidence(value as ExternalHandoffRecord)
      ]
    : (validateSchema.errors ?? []).map(schemaError);
  errors.push(...scanSensitive(value).map((finding) => ({
    code: "SENSITIVE_VALUE" as const,
    location: finding.location,
    message: `matched ${finding.code}`
  })));
  errors.push(...publicationRisks(value));
  return { valid: errors.length === 0, errors };
}

function countCodes(codes: readonly string[]): Array<{ code: string; attempts: number }> {
  const counts = new Map<string, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts]
    .map(([code, attempts]) => ({ code, attempts }))
    .sort((left, right) => right.attempts - left.attempts || left.code.localeCompare(right.code));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

export function aggregateExternalAcceptance(
  records: readonly ExternalHandoffRecord[]
): ExternalAcceptanceReport {
  const participants = new Set<string>();
  const attempts = new Set<string>();
  const evidence = new Set<string>();
  for (const record of records) {
    const validation = validateExternalHandoffRecord(record);
    if (!validation.valid) {
      throw new Error(`invalid acceptance record ${record.attemptId}: ${validation.errors[0]?.message ?? "unknown error"}`);
    }
    const handle = record.participant.githubHandle.toLocaleLowerCase("en-US");
    if (participants.has(handle)) throw new Error(`duplicate participant ${record.participant.githubHandle}`);
    if (attempts.has(record.attemptId)) throw new Error(`duplicate attempt ${record.attemptId}`);
    if (evidence.has(record.participant.evidenceUrl)) {
      throw new Error(`duplicate evidence ${record.participant.evidenceUrl}`);
    }
    participants.add(handle);
    attempts.add(record.attemptId);
    evidence.add(record.participant.evidenceUrl);
  }

  const continued = records.filter((record) => record.attempt.outcome === "continued");
  const platformCounts = {
    windows: records.filter((record) => record.environment.os === "windows").length,
    macos: records.filter((record) => record.environment.os === "macos").length
  };
  const reviewedRecords = records.filter((record) => (
    record.review.evidenceAuthorMatchesParticipant
    && record.review.nonAuthorHistoryChecked
    && record.review.privacyReviewPassed
  )).length;
  return {
    schemaVersion: "1.0.0",
    distinctParticipants: participants.size,
    attempts: records.length,
    continued: continued.length,
    blocked: records.length - continued.length,
    continuationRate: records.length === 0 ? 0 : continued.length / records.length,
    manualSupplementAttempts: records.filter(
      (record) => record.attempt.manualSupplement.required
    ).length,
    reviewedRecords,
    medianSecondsToContinuation: median(continued.map(
      (record) => record.timing.secondsToContinuation!
    )),
    platformCounts,
    manualSupplementCategories: countCodes(records.flatMap((record) =>
      record.attempt.manualSupplement.categories
    )),
    lossCodes: countCodes(records.flatMap((record) => record.attempt.lossCodes)),
    blockers: countCodes(records.flatMap((record) =>
      record.attempt.blockers.map((blocker) => blocker.code)
    )),
    cohortReady: participants.size >= 10
      && platformCounts.windows > 0
      && platformCounts.macos > 0
      && reviewedRecords === records.length,
    records: records.map((record) => ({
      participant: record.participant.githubHandle,
      evidenceUrl: record.participant.evidenceUrl,
      os: record.environment.os,
      outcome: record.attempt.outcome,
      secondsToContinuation: record.timing.secondsToContinuation,
      manualSupplementRequired: record.attempt.manualSupplement.required,
      lossCodes: record.attempt.lossCodes,
      blockerCodes: record.attempt.blockers.map((blocker) => blocker.code),
      failureIssueUrls: record.attempt.blockers.map((blocker) => blocker.followUpIssueUrl)
    }))
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function codeRows(values: ReadonlyArray<{ code: string; attempts: number }>): string {
  return values.length === 0
    ? "None."
    : values.map((value) => `- ${value.code}: ${value.attempts}`).join("\n");
}

export function renderExternalAcceptanceMarkdown(report: ExternalAcceptanceReport): string {
  const rows = report.records.map((record) => {
    const time = record.secondsToContinuation === null ? "—" : String(record.secondsToContinuation);
    const losses = record.lossCodes.length === 0 ? "—" : record.lossCodes.join(", ");
    const blockers = record.blockerCodes.length === 0 ? "—" : record.blockerCodes.join(", ");
    const failureIssues = record.failureIssueUrls.length === 0
      ? "—"
      : record.failureIssueUrls.map((url) => `[Issue](${url})`).join(", ");
    return `| [${record.participant}](${record.evidenceUrl}) | ${record.os} | ${record.outcome} | ${time} | ${record.manualSupplementRequired ? "yes" : "no"} | ${losses} | ${blockers} | ${failureIssues} |`;
  }).join("\n");
  return `# AgentCarry external handoff acceptance

- Cohort gate: **${report.cohortReady ? "PASS" : "COLLECTING"}**
- Evidence trust boundary: repository-owner attestation with public audit links; no GitHub API claim
- Distinct non-author participants: ${report.distinctParticipants} / 10 minimum
- Platforms: Windows ${report.platformCounts.windows}; macOS ${report.platformCounts.macos}
- Continued: ${report.continued} / ${report.attempts} (${percent(report.continuationRate)})
- Blocked: ${report.blocked} / ${report.attempts}
- Manual supplement required: ${report.manualSupplementAttempts} / ${report.attempts}
- Maintainer-reviewed evidence: ${report.reviewedRecords} / ${report.attempts}
- Median seconds to continuation: ${report.medianSecondsToContinuation ?? "not available"}

| Participant evidence | OS | Outcome | Seconds to continuation | Manual supplement | Loss codes | Blockers | Failure Issues |
| --- | --- | --- | ---: | --- | --- | --- | --- |
${rows}

## Common loss codes

${codeRows(report.lossCodes)}

## Manual Supplement categories

${codeRows(report.manualSupplementCategories)}

## Blockers

${codeRows(report.blockers)}
`;
}
