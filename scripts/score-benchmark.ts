import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { fileURLToPath } from "node:url";
import {
  renderScoreMarkdown,
  renderScoreJson,
  scoreAssessment,
  type ContinuationAssessment,
  type ScoreableFixture
} from "../src/benchmark/score-assessment.js";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const formatIndex = args.indexOf("--format");
  const format = formatIndex === -1 ? "json" : args[formatIndex + 1];
  if (formatIndex !== -1) {
    args.splice(formatIndex, 2);
  }
  if (args.length !== 2 || (format !== "json" && format !== "markdown")) {
    console.error("Usage: score-benchmark <fixture.json> <assessment.json> [--format json|markdown]");
    process.exitCode = 2;
    return;
  }

  const fixture = await readJson(args[0]!) as ScoreableFixture;
  const assessment = await readJson(args[1]!);
  const schemaPath = fileURLToPath(
    new URL("../benchmark/schema/continuation-assessment.v1.schema.json", import.meta.url)
  );
  const schema = await readJson(schemaPath) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value: string) => !Number.isNaN(Date.parse(value))
  });
  const validate = ajv.compile(schema);
  if (!validate(assessment)) {
    for (const error of validate.errors ?? []) {
      console.error(`SCHEMA ${error.instancePath || "/"}: ${error.message ?? error.keyword}`);
    }
    process.exitCode = 1;
    return;
  }

  const report = scoreAssessment(fixture, assessment as ContinuationAssessment);
  process.stdout.write(
    format === "json"
      ? renderScoreJson(report)
      : renderScoreMarkdown(report)
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
