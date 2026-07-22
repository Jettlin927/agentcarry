import { Ajv2020 } from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scanSensitive } from "../security/redact.js";
const schemaPath = fileURLToPath(new URL("../../benchmark/schema/continuity-fixture.v1.schema.json", import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", {
    type: "string",
    validate: (value) => !Number.isNaN(Date.parse(value))
});
const validateSchema = ajv.compile(schema);
function schemaError(error) {
    return {
        code: "SCHEMA",
        location: error.instancePath || "/",
        message: error.message ?? error.keyword
    };
}
function duplicateIds(ids, location) {
    const seen = new Set();
    const duplicates = new Set();
    for (const id of ids) {
        if (seen.has(id)) {
            duplicates.add(id);
        }
        seen.add(id);
    }
    return [...duplicates].map((id) => ({
        code: "DUPLICATE_ID",
        location,
        message: `duplicate id ${id}`
    }));
}
function validateEvidence(value) {
    const errors = [];
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
export function validateFixture(value) {
    const validSchema = validateSchema(value);
    const errors = validSchema ? [] : (validateSchema.errors ?? []).map(schemaError);
    if (validSchema) {
        errors.push(...validateEvidence(value));
    }
    errors.push(...scanSensitive(value).map((finding) => ({
        code: "SENSITIVE_VALUE",
        location: finding.location,
        message: `matched ${finding.code}`
    })));
    return { valid: errors.length === 0, errors };
}
