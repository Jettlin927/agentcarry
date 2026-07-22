import { describe, expect, it } from "vitest";
import {
  aggregateExternalAcceptance,
  renderExternalAcceptanceMarkdown,
  validateExternalHandoffRecord,
  type ExternalHandoffRecord
} from "../src/acceptance/external-acceptance.js";

function record(index: number, overrides: Partial<ExternalHandoffRecord> = {}): ExternalHandoffRecord {
  const continued = index <= 8;
  const base: ExternalHandoffRecord = {
    schemaVersion: "1.0.0",
    attemptId: `participant-${String(index).padStart(2, "0")}-20260723`,
    recordedAt: "2026-07-23T08:00:00Z",
    participant: {
      githubHandle: `participant-${index}`,
      nonAuthorAtAttempt: true,
      evidenceUrl: `https://github.com/Jettlin927/agentcarry/issues/${100 + index}`,
      consentToPublish: true
    },
    environment: {
      os: index <= 6 ? "windows" : "macos",
      osVersion: index <= 6 ? "Windows 11" : "macOS 15.5",
      architecture: "x64",
      nodeVersion: "v22.18.0",
      agentCarryCommit: "a".repeat(40),
      codexVersion: "0.145.0-alpha.27",
      claudeCodeVersion: "2.1.158"
    },
    attempt: {
      sourceState: "idle",
      selection: "automatic",
      outcome: continued ? "continued" : "blocked",
      targetSessionCreated: continued,
      firstActionStarted: continued,
      manualSupplement: continued && index % 4 === 0
        ? {
            required: true,
            categories: ["next-action"],
            sanitizedSummary: "Clarified which focused test should run first."
          }
        : { required: false, categories: [] },
      lossCodes: index % 2 === 0
        ? ["HIDDEN_AGENT_STATE_UNAVAILABLE"]
        : ["DETERMINISTIC_SEMANTIC_HEURISTIC", "HIDDEN_AGENT_STATE_UNAVAILABLE"],
      blockers: continued
        ? []
        : [{
            code: "TARGET_PROVIDER_UNAVAILABLE",
            phase: "target-resume",
            sanitizedSummary: "Configured provider returned a temporary unavailable error."
          }]
    },
    timing: {
      commandStartedAt: "2026-07-23T07:58:00Z",
      outcomeRecordedAt: "2026-07-23T08:00:00Z",
      secondsToOutcome: 120,
      secondsToContinuation: continued ? index * 10 : null
    },
    privacy: {
      noSecrets: true,
      noPrivateTranscript: true,
      noUnredactedSourceFile: true
    }
  };
  return { ...base, ...overrides };
}

describe("external handoff acceptance", () => {
  it("accepts one privacy-safe, auditable continuation record", () => {
    expect(validateExternalHandoffRecord(record(1))).toEqual({ valid: true, errors: [] });
  });

  it("rejects secrets, author records, and false continuation claims", () => {
    const invalid = {
      ...record(1),
      participant: {
        ...record(1).participant,
        nonAuthorAtAttempt: false
      },
      attempt: {
        ...record(1).attempt,
        firstActionStarted: false,
        manualSupplement: {
          required: true,
          categories: ["constraint"],
          sanitizedSummary: `Leaked sk-${"x".repeat(32)}`
        }
      }
    };

    const result = validateExternalHandoffRecord(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "SCHEMA",
      "SENSITIVE_VALUE"
    ]));
    expect(JSON.stringify(result.errors)).not.toContain(`sk-${"x".repeat(32)}`);
  });

  it("aggregates ten distinct participants across Windows and macOS", () => {
    const records = Array.from({ length: 10 }, (_, index) => record(index + 1));

    const report = aggregateExternalAcceptance(records);

    expect(report).toMatchObject({
      schemaVersion: "1.0.0",
      distinctParticipants: 10,
      attempts: 10,
      continued: 8,
      blocked: 2,
      continuationRate: 0.8,
      manualSupplementAttempts: 2,
      cohortReady: true,
      platformCounts: { windows: 6, macos: 4 }
    });
    expect(report.medianSecondsToContinuation).toBe(45);
    expect(report.lossCodes[0]).toEqual({ code: "HIDDEN_AGENT_STATE_UNAVAILABLE", attempts: 10 });
    expect(report.manualSupplementCategories).toEqual([{
      code: "next-action",
      attempts: 2
    }]);
    expect(report.blockers).toEqual([{
      code: "TARGET_PROVIDER_UNAVAILABLE",
      attempts: 2
    }]);
  });

  it("keeps an incomplete cohort reportable but rejects duplicate participants", () => {
    expect(aggregateExternalAcceptance(
      Array.from({ length: 9 }, (_, index) => record(index + 1))
    ).cohortReady).toBe(false);

    expect(() => aggregateExternalAcceptance([record(1), record(2, {
      participant: record(1).participant
    })])).toThrow("duplicate participant participant-1");
  });

  it("renders an auditable Markdown table and cohort gates", () => {
    const report = aggregateExternalAcceptance(
      Array.from({ length: 10 }, (_, index) => record(index + 1))
    );
    const markdown = renderExternalAcceptanceMarkdown(report);

    expect(markdown).toContain("Cohort gate: **PASS**");
    expect(markdown).toContain("8 / 10 (80.0%)");
    expect(markdown).toContain("[participant-1](https://github.com/Jettlin927/agentcarry/issues/101)");
    expect(markdown).toContain("TARGET_PROVIDER_UNAVAILABLE");
  });
});
