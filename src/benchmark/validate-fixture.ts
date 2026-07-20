import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scanSensitive } from "../security/redact.js";

export interface FixtureValidationError {
  readonly code: "SCHEMA" | "SENSITIVE_VALUE" | "REFERENCE" | "DUPLICATE_ID";
  readonly location: string;
  readonly message: string;
}

export interface FixtureValidationResult {
  readonly valid: boolean;
  readonly errors: readonly FixtureValidationError[];
}

const schemaPath = fileURLToPath(
  new URL("../../benchmark/schema/continuity-fixture.v1.schema.json", import.meta.url)
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) => !Number.isNaN(Date.parse(value))
});
const validateSchema = ajv.compile(schema);

interface EvidenceFact {
  readonly id: string;
  readonly evidenceRefs: readonly string[];
  readonly critical?: boolean;
}

interface ValidatedFixtureShape {
  readonly source: { readonly events: ReadonlyArray<{ readonly id: string }> };
  readonly groundTruth: {
    readonly criticalConstraints: readonly EvidenceFact[];
    readonly objectiveAndState: readonly EvidenceFact[];
    readonly decisionsAndFailedAttempts: readonly EvidenceFact[];
    readonly completedAndPending: readonly EvidenceFact[];
    readonly workspaceEvidence: readonly EvidenceFact[];
    readonly nextAction: EvidenceFact;
  };
}

function schemaError(error: ErrorObject): FixtureValidationError {
  return {
    code: "SCHEMA",
    location: error.instancePath || "/",
    message: error.message ?? error.keyword
  };
}

function duplicateIds(ids: readonly string[], location: string): FixtureValidationError[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  return [...duplicates].map((id) => ({
    code: "DUPLICATE_ID" as const,
    location,
    message: `duplicate id ${id}`
  }));
}

function validateEvidence(value: ValidatedFixtureShape): FixtureValidationError[] {
  const errors: FixtureValidationError[] = [];
  const eventIds = value.source.events.map((event) => event.id);
  const eventIdSet = new Set(eventIds);
  errors.push(...duplicateIds(eventIds, "/source/events"));

  const categories = [
    value.groundTruth.criticalConstraints,
    value.groundTruth.objectiveAndState,
    value.groundTruth.decisionsAndFailedAttempts,
    value.groundTruth.completedAndPending,
    value.groundTruth.workspaceEvidence,
    [value.groundTruth.nextAction]
  ];
  const facts = categories.flat();
  errors.push(...duplicateIds(facts.map((fact) => fact.id), "/groundTruth"));

  for (const fact of facts) {
    for (const evidenceRef of fact.evidenceRefs) {
      if (!eventIdSet.has(evidenceRef)) {
        errors.push({
          code: "REFERENCE",
          location: `/groundTruth/${fact.id}/evidenceRefs`,
          message: `unknown source event ${evidenceRef}`
        });
      }
    }
  }

  value.groundTruth.criticalConstraints.forEach((fact) => {
    if (fact.critical !== true) {
      errors.push({
        code: "REFERENCE",
        location: `/groundTruth/criticalConstraints/${fact.id}`,
        message: "critical constraint must set critical to true"
      });
    }
  });

  return errors;
}

export function validateFixture(value: unknown): FixtureValidationResult {
  const validSchema = validateSchema(value);
  const errors = validSchema ? [] : (validateSchema.errors ?? []).map(schemaError);
  if (validSchema) {
    errors.push(...validateEvidence(value as ValidatedFixtureShape));
  }
  errors.push(...scanSensitive(value).map((finding) => ({
    code: "SENSITIVE_VALUE" as const,
    location: finding.location,
    message: `matched ${finding.code}`
  })));
  return { valid: errors.length === 0, errors };
}
