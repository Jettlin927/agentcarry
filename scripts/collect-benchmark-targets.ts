import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  canonicalJson,
  type BenchmarkSourceFixture
} from "../src/benchmark/build-handoff-input.js";
import {
  collectTargetRuns,
  createBenchmarkRunPlan
} from "../src/benchmark/collect-target-runs.js";
import { validateFixture } from "../src/benchmark/validate-fixture.js";

async function readFixtures(directory: string): Promise<BenchmarkSourceFixture[]> {
  const paths = (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => resolve(directory, name));
  return await Promise.all(paths.map(async (path) => {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    const validation = validateFixture(value);
    if (!validation.valid) {
      throw new Error(`${path}: ${validation.errors.map((error) => error.message).join("; ")}`);
    }
    return value as BenchmarkSourceFixture;
  }));
}

const args = process.argv.slice(2);
const fixtureDirectory = args.shift();
const modelIndex = args.indexOf("--model");
const outputIndex = args.indexOf("--output");
const providerIndex = args.indexOf("--provider");
const settingSourcesIndex = args.indexOf("--setting-sources");
const model = modelIndex === -1 ? undefined : args[modelIndex + 1];
const output = outputIndex === -1 ? undefined : args[outputIndex + 1];
const provider = providerIndex === -1 ? undefined : args[providerIndex + 1];
const settingSources = settingSourcesIndex === -1
  ? "none"
  : args[settingSourcesIndex + 1];
const planOnly = args.includes("--plan");

if (
  fixtureDirectory === undefined
  || model === undefined
  || (!planOnly && output === undefined)
  || (settingSources !== "none" && settingSources !== "user")
  || (settingSources === "user" && provider === undefined)
) {
  process.stderr.write(
    "Usage: collect-benchmark-targets <fixture-dir> --model <model> "
      + "[--setting-sources none|user --provider <public-label>] "
      + "[--plan | --output <directory>]\n"
  );
  process.exitCode = 2;
} else {
  try {
    const fixtures = await readFixtures(resolve(fixtureDirectory));
    const execution = {
      ...(provider === undefined ? {} : { provider }),
      settingSources
    } as const;
    if (planOnly) {
      process.stdout.write(canonicalJson(createBenchmarkRunPlan(fixtures, model, execution)));
    } else {
      const summary = await collectTargetRuns(fixtures, model, resolve(output!), {
        onProgress: (message) => { process.stderr.write(`${message}\n`); }
      }, execution);
      process.stdout.write(canonicalJson(summary));
    }
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
