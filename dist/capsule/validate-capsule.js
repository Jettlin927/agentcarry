import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
const schemaPath = fileURLToPath(new URL("../../schema/work-capsule.v2.schema.json", import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", {
    type: "string",
    validate: (value) => !Number.isNaN(Date.parse(value))
});
const validate = ajv.compile(schema);
export function validateWorkCapsule(value) {
    return validate(value) ? [] : [...(validate.errors ?? [])];
}
