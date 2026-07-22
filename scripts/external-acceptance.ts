import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  aggregateExternalAcceptance,
  renderExternalAcceptanceMarkdown,
  validateExternalHandoffRecord,
  type ExternalHandoffRecord
} from "../src/acceptance/external-acceptance.js";

async function jsonFiles(path: string): Promise<string[]> {
  const metadata = await stat(path);
  if (metadata.isFile()) return path.endsWith(".json") ? [path] : [];
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) =>
    jsonFiles(resolve(path, entry.name))
  ))).flat().sort();
}

async function readRecords(path: string): Promise<ExternalHandoffRecord[]> {
  const records: ExternalHandoffRecord[] = [];
  let invalid = false;
  for (const file of await jsonFiles(resolve(path))) {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(file, "utf8")) as unknown;
    } catch {
      console.error(`FAIL ${file}: invalid JSON`);
      invalid = true;
      continue;
    }
    const result = validateExternalHandoffRecord(value);
    if (!result.valid) {
      invalid = true;
      console.error(`FAIL ${file}`);
      for (const error of result.errors) {
        console.error(`  ${error.code} ${error.location || "/"}: ${error.message}`);
      }
      continue;
    }
    console.log(`PASS ${file}`);
    records.push(value as ExternalHandoffRecord);
  }
  if (invalid) throw new Error("one or more external acceptance records are invalid");
  return records;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const path = process.argv[3] ?? "acceptance/runs";
  if (command !== "validate" && command !== "report") {
    console.error("Usage: external-acceptance <validate|report> [records-path] [--require-complete] [--output <path>]");
    process.exitCode = 2;
    return;
  }
  const records = await readRecords(path);
  const report = aggregateExternalAcceptance(records);
  if (command === "validate") {
    console.log(`PASS ${records.length} valid external handoff record(s); cohort ${report.cohortReady ? "ready" : "collecting"}`);
    return;
  }

  const markdown = renderExternalAcceptanceMarkdown(report);
  const output = option("--output");
  if (output === undefined) {
    process.stdout.write(markdown);
  } else {
    await writeFile(resolve(output), markdown, "utf8");
    console.log(`WROTE ${resolve(output)}`);
  }
  if (process.argv.includes("--require-complete") && !report.cohortReady) {
    console.error("External acceptance cohort requires 10 distinct non-author participants and both Windows and macOS.");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
