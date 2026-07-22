import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  aggregateExternalAcceptance,
  renderExternalAcceptanceMarkdown,
  validateExternalHandoffRecord,
  type ExternalHandoffRecord
} from "../src/acceptance/external-acceptance.js";

async function jsonFiles(path: string): Promise<string[]> {
  const root = resolve(path);
  const metadata = await lstat(root);
  if (metadata.isSymbolicLink()) throw new Error(`records path must not be a symbolic link: ${root}`);
  if (metadata.isFile()) return root.endsWith(".json") ? [root] : [];
  if (!metadata.isDirectory()) return [];

  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const nested = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(nested);
      } else if (entry.isFile() && nested.endsWith(".json")) {
        files.push(nested);
      }
    }
  };
  await visit(root);
  return files.sort();
}

async function readRecords(path: string, verbose: boolean): Promise<ExternalHandoffRecord[]> {
  const records: ExternalHandoffRecord[] = [];
  let invalid = false;
  for (const file of await jsonFiles(resolve(path))) {
    let value: unknown;
    try {
      const text = await readFile(file, "utf8");
      value = JSON.parse(text.replace(/^﻿/, "")) as unknown;
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
    if (verbose) console.log(`PASS ${file}`);
    records.push(value as ExternalHandoffRecord);
  }
  if (invalid) throw new Error("one or more external acceptance records are invalid");
  return records;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a path`);
  }
  return value;
}

function normalizedNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const path = process.argv[3] ?? "acceptance/runs";
  if (command !== "validate" && command !== "report") {
    console.error("Usage: external-acceptance <validate|report> [records-path] [--require-complete] [--output <path> | --check <path>]");
    process.exitCode = 2;
    return;
  }
  const records = await readRecords(path, command === "validate");
  const report = aggregateExternalAcceptance(records);
  if (command === "validate") {
    console.log(`PASS ${records.length} valid external handoff record(s); cohort ${report.cohortReady ? "ready" : "collecting"}`);
    return;
  }

  const markdown = renderExternalAcceptanceMarkdown(report);
  const output = option("--output");
  const check = option("--check");
  if (output !== undefined && check !== undefined) {
    console.error("Use either --output or --check, not both.");
    process.exitCode = 2;
    return;
  }
  if (check !== undefined) {
    const reportPath = resolve(check);
    if (normalizedNewlines(await readFile(reportPath, "utf8")) !== normalizedNewlines(markdown)) {
      console.error(`STALE ${reportPath}`);
      process.exitCode = 1;
      return;
    }
    console.log(`PASS ${reportPath} matches acceptance records`);
  } else if (output === undefined) {
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
