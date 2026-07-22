import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { scanSensitive } from "../security/redact.js";
const schemaPath = fileURLToPath(new URL("../../schema/external-handoff-record.v1.schema.json", import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
formatsPlugin(ajv);
const validateSchema = ajv.compile(schema);
function schemaError(error) {
    return {
        code: "SCHEMA",
        location: error.instancePath || "/",
        message: error.message ?? error.keyword
    };
}
function validateTiming(record) {
    const start = Date.parse(record.timing.commandStartedAt);
    const end = Date.parse(record.timing.outcomeRecordedAt);
    const expectedSeconds = Math.round((end - start) / 1_000);
    const errors = [];
    if (expectedSeconds < 0 || expectedSeconds !== record.timing.secondsToOutcome) {
        errors.push({
            code: "TIMING",
            location: "/timing/secondsToOutcome",
            message: "must equal the elapsed whole seconds between commandStartedAt and outcomeRecordedAt"
        });
    }
    if (record.attempt.outcome === "continued"
        && record.timing.secondsToContinuation !== record.timing.secondsToOutcome) {
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
];
function publicationRisks(value, location = "") {
    if (typeof value === "string") {
        return publicationRiskPatterns
            .filter((candidate) => candidate.pattern.test(value))
            .map((candidate) => ({
            code: "SENSITIVE_VALUE",
            location: location || "/",
            message: `matched ${candidate.code}`
        }));
    }
    if (Array.isArray(value)) {
        return value.flatMap((nested, index) => publicationRisks(nested, `${location}/${index}`));
    }
    if (value !== null && typeof value === "object") {
        return Object.entries(value).flatMap(([key, nested]) => publicationRisks(nested, `${location}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`));
    }
    return [];
}
function validateEvidence(record) {
    const errors = [];
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
export function validateExternalHandoffRecord(value) {
    const validSchema = validateSchema(value);
    const errors = validSchema
        ? [
            ...validateTiming(value),
            ...validateEvidence(value)
        ]
        : (validateSchema.errors ?? []).map(schemaError);
    errors.push(...scanSensitive(value).map((finding) => ({
        code: "SENSITIVE_VALUE",
        location: finding.location,
        message: `matched ${finding.code}`
    })));
    errors.push(...publicationRisks(value));
    return { valid: errors.length === 0, errors };
}
function countCodes(codes) {
    const counts = new Map();
    for (const code of codes)
        counts.set(code, (counts.get(code) ?? 0) + 1);
    return [...counts]
        .map(([code, attempts]) => ({ code, attempts }))
        .sort((left, right) => right.attempts - left.attempts || left.code.localeCompare(right.code));
}
function median(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}
export function aggregateExternalAcceptance(records) {
    const participants = new Set();
    const attempts = new Set();
    const evidence = new Set();
    for (const record of records) {
        const validation = validateExternalHandoffRecord(record);
        if (!validation.valid) {
            throw new Error(`invalid acceptance record ${record.attemptId}: ${validation.errors[0]?.message ?? "unknown error"}`);
        }
        const handle = record.participant.githubHandle.toLocaleLowerCase("en-US");
        if (participants.has(handle))
            throw new Error(`duplicate participant ${record.participant.githubHandle}`);
        if (attempts.has(record.attemptId))
            throw new Error(`duplicate attempt ${record.attemptId}`);
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
    const reviewedRecords = records.filter((record) => (record.review.evidenceAuthorMatchesParticipant
        && record.review.nonAuthorHistoryChecked
        && record.review.privacyReviewPassed)).length;
    return {
        schemaVersion: "1.0.0",
        distinctParticipants: participants.size,
        attempts: records.length,
        continued: continued.length,
        blocked: records.length - continued.length,
        continuationRate: records.length === 0 ? 0 : continued.length / records.length,
        manualSupplementAttempts: records.filter((record) => record.attempt.manualSupplement.required).length,
        reviewedRecords,
        medianSecondsToContinuation: median(continued.map((record) => record.timing.secondsToContinuation)),
        platformCounts,
        manualSupplementCategories: countCodes(records.flatMap((record) => record.attempt.manualSupplement.categories)),
        lossCodes: countCodes(records.flatMap((record) => record.attempt.lossCodes)),
        blockers: countCodes(records.flatMap((record) => record.attempt.blockers.map((blocker) => blocker.code))),
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
function percent(value) {
    return `${(value * 100).toFixed(1)}%`;
}
function codeRows(values) {
    return values.length === 0
        ? "None."
        : values.map((value) => `- ${value.code}: ${value.attempts}`).join("\n");
}
export function renderExternalAcceptanceMarkdown(report) {
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
