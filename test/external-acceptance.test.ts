import { describe, expect, it } from "vitest";
import {
  aggregateExternalAcceptance,
  renderExternalAcceptanceMarkdown,
  validateExternalHandoffRecord,
  type ExternalHandoffRecord
} from "../src/acceptance/external-acceptance.js";

function record(index: number, overrides: Partial<ExternalHandoffRecord> = {}): ExternalHandoffRecord {
  const continued = index <= 8;
  const elapsedSeconds = continued ? index * 10 : 120;
  const outcomeRecordedAt = "2026-07-23T08:00:00.000Z";
  const commandStartedAt = new Date(
    Date.parse(outcomeRecordedAt) - elapsedSeconds * 1_000
  ).toISOString();
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
      agentCarryVersion: "0.1.0-acceptance.1",
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
            categories: ["next-action"]
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
            followUpIssueUrl: `https://github.com/Jettlin927/agentcarry/issues/${200 + index}`
          }]
    },
    timing: {
      commandStartedAt,
      outcomeRecordedAt,
      secondsToOutcome: elapsedSeconds,
      secondsToContinuation: continued ? elapsedSeconds : null
    },
    review: {
      reviewedBy: "Jettlin927",
      reviewedAt: "2026-07-23T09:00:00Z",
      evidenceAuthorMatchesParticipant: true,
      nonAuthorHistoryChecked: true,
      privacyReviewPassed: true
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
      environment: {
        ...record(1).environment,
        osVersion: `Leaked sk-${"x".repeat(32)}`
      },
      attempt: {
        ...record(1).attempt,
        firstActionStarted: false,
        manualSupplement: {
          required: true,
          categories: ["constraint"]
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

  it("rejects non-RFC3339 dates, inconsistent continuation timing, and publication PII", () => {
    const result = validateExternalHandoffRecord({
      ...record(1),
      recordedAt: "2026-07-23",
      environment: {
        ...record(1).environment,
        osVersion: "Contact alice@example.com about C:\\Users\\Alice\\private.txt"
      },
      timing: {
        ...record(1).timing,
        secondsToContinuation: 11
      }
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "SCHEMA",
      "SENSITIVE_VALUE"
    ]));
    expect(result.errors.filter((error) => error.code === "SENSITIVE_VALUE")).toHaveLength(2);

    for (const path of [
      "D:\\client\\secret.txt",
      "\\\\server\\private\\secret.txt",
      "/srv/private/secret.txt"
    ]) {
      const privatePath = validateExternalHandoffRecord({
        ...record(1),
        environment: {
          ...record(1).environment,
          osVersion: `Removed private details from ${path}`
        }
      });
      expect(privatePath.errors).toContainEqual(expect.objectContaining({
        code: "SENSITIVE_VALUE",
        message: "matched PRIVATE_LOCAL_PATH"
      }));
    }

    const timing = validateExternalHandoffRecord({
      ...record(1),
      timing: { ...record(1).timing, secondsToContinuation: 11 }
    });
    expect(timing.errors).toContainEqual(expect.objectContaining({ code: "TIMING" }));
  });

  it("rejects reversed subsecond timing and punctuated private paths", () => {
    const reversed = validateExternalHandoffRecord({
      ...record(1),
      timing: {
        commandStartedAt: "2026-07-23T08:00:00.499Z",
        outcomeRecordedAt: "2026-07-23T08:00:00.000Z",
        secondsToOutcome: 0,
        secondsToContinuation: 0
      }
    });
    expect(reversed.errors).toContainEqual(expect.objectContaining({ code: "TIMING" }));

    for (const osVersion of [
      "path=/Users/alice/private.txt",
      "Removed (/Users/alice/private.txt)"
    ]) {
      const privatePath = validateExternalHandoffRecord({
        ...record(1),
        environment: { ...record(1).environment, osVersion }
      });
      expect(privatePath.errors).toContainEqual(expect.objectContaining({
        code: "SENSITIVE_VALUE",
        message: "matched PRIVATE_LOCAL_PATH"
      }));
    }
  });

  it("requires a separate follow-up Issue for every blocked failure mode", () => {
    const blocked = record(9);
    const result = validateExternalHandoffRecord({
      ...blocked,
      attempt: {
        ...blocked.attempt,
        blockers: blocked.attempt.blockers.map((blocker) => ({
          ...blocker,
          followUpIssueUrl: blocked.participant.evidenceUrl
        }))
      }
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "EVIDENCE" }));

    expect(validateExternalHandoffRecord({
      ...blocked,
      attempt: {
        ...blocked.attempt,
        blockers: blocked.attempt.blockers.map((blocker) => ({ ...blocker, code: "NONE" }))
      }
    }).errors).toContainEqual(expect.objectContaining({ code: "SCHEMA" }));

    expect(validateExternalHandoffRecord({
      ...record(1),
      attempt: { ...record(1).attempt, lossCodes: ["NONE"] }
    }).errors).toContainEqual(expect.objectContaining({ code: "SCHEMA" }));
  });

  it("rejects unreviewed and participant-reviewed evidence", () => {
    const { review: _review, ...unreviewed } = record(1);
    expect(validateExternalHandoffRecord(unreviewed).errors).toContainEqual(
      expect.objectContaining({ code: "SCHEMA" })
    );

    const participantReviewed = validateExternalHandoffRecord({
      ...record(1),
      review: { ...record(1).review, reviewedBy: record(1).participant.githubHandle }
    });
    expect(participantReviewed.errors).toContainEqual(expect.objectContaining({ code: "SCHEMA" }));
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
      reviewedRecords: 10,
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

    expect(() => aggregateExternalAcceptance([record(1, {
      participant: {
        ...record(1).participant,
        evidenceUrl: "https://github.com/Jettlin927/agentcarry/issues/101#issuecomment-1"
      }
    }), record(2, {
      participant: {
        ...record(2).participant,
        evidenceUrl: "https://github.com/Jettlin927/agentcarry/issues/101#issuecomment-2"
      }
    })])).toThrow("duplicate evidence https://github.com/Jettlin927/agentcarry/issues/101");
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
    expect(markdown).toContain("[Issue](https://github.com/Jettlin927/agentcarry/issues/209)");
  });
});
