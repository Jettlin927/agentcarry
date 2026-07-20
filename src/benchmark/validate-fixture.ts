import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface FixtureValidationError {
  readonly code: "SCHEMA" | "SENSITIVE_VALUE" | "REFERENCE" | "DUPLICATE_ID";
  readonly location: string;
  readonly message: string;
}

export interface FixtureValidationResult {
  readonly valid: boolean;
  readonly errors: readonly FixtureValidationError[];
}

interface SensitivePattern {
  readonly code: string;
  readonly pattern: RegExp;
}

const sensitivePatterns: readonly SensitivePattern[] = [
  { code: "OPENAI_API_KEY", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { code: "ANTHROPIC_API_KEY", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { code: "GITHUB_TOKEN", pattern: /\bgh[opusr]_[A-Za-z0-9]{20,}\b/ },
  { code: "AWS_ACCESS_KEY_ID", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { code: "PRIVATE_KEY", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { code: "BEARER_TOKEN", pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}={0,2}\b/i },
  { code: "CREDENTIAL_URL", pattern: /\bhttps?:\/\/[^\s/:]+:[^\s/@]+@[^\s]+/i }
];

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

function scanStrings(value: unknown, location: string, errors: FixtureValidationError[]): void {
  if (typeof value === "string") {
    for (const candidate of sensitivePatterns) {
      candidate.pattern.lastIndex = 0;
      if (candidate.pattern.test(value)) {
        errors.push({
          code: "SENSITIVE_VALUE",
          location,
          message: `matched ${candidate.code}`
        });
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanStrings(item, `${location}/${index}`, errors));
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const escapedKey = key.replaceAll("~", "~0").replaceAll("/", "~1");
      scanStrings(nested, `${location}/${escapedKey}`, errors);
    }
  }
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
  scanStrings(value, "", errors);
  return { valid: errors.length === 0, errors };
}
