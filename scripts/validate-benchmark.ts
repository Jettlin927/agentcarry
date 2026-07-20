import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { validateFixture } from "../src/benchmark/validate-fixture.js";

async function jsonFiles(path: string): Promise<string[]> {
  const metadata = await stat(path);
  if (metadata.isFile()) {
    return path.endsWith(".json") ? [path] : [];
  }

  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => jsonFiles(resolve(path, entry.name)))
  );
  return nested.flat().sort();
}

async function main(): Promise<void> {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error("Usage: validate-benchmark <fixture-or-directory> [...]");
    process.exitCode = 2;
    return;
  }

  let invalid = false;
  for (const target of targets) {
    for (const path of await jsonFiles(resolve(target))) {
      const value = JSON.parse(await readFile(path, "utf8")) as unknown;
      const result = validateFixture(value);
      if (result.valid) {
        console.log(`PASS ${path}`);
        continue;
      }

      invalid = true;
      console.error(`FAIL ${path}`);
      for (const error of result.errors) {
        console.error(`  ${error.code} ${error.location || "/"}: ${error.message}`);
      }
    }
  }

  if (invalid) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});

