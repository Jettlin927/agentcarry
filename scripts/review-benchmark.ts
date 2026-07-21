import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  renderAggregateJson,
  renderAggregateMarkdown
} from "../src/benchmark/aggregate-report.js";
import { canonicalJson } from "../src/benchmark/build-handoff-input.js";
import {
  finalizeBenchmarkReview,
  renderReviewPacket,
  type AdvisoryVerdictSet,
  type ReviewFixture
} from "../src/benchmark/review-materialization.js";
import type { TargetRunResult } from "../src/benchmark/run-target-continuation.js";
import {
  renderScoreJson,
  renderScoreMarkdown
} from "../src/benchmark/score-assessment.js";
import { validateFixture } from "../src/benchmark/validate-fixture.js";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function readFixtures(directory: string): Promise<ReviewFixture[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return await Promise.all(names.map(async (name) => {
    const path = join(directory, name);
    const value = await readJson(path);
    const validation = validateFixture(value);
    if (!validation.valid) {
      throw new Error(`${path}: ${validation.errors.map((error) => error.message).join("; ")}`);
    }
    return value as ReviewFixture;
  }));
}

async function readResults(runDirectory: string): Promise<TargetRunResult[]> {
  const directory = join(runDirectory, "results");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return await Promise.all(names.map(async (name) =>
    await readJson(join(directory, name)) as TargetRunResult
  ));
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function artifactStem(runId: string): string {
  const stem = runId.replaceAll(":", "--");
  if (!/^[A-Za-z0-9._-]+$/.test(stem)) {
    throw new Error(`run id is not safe for an artifact filename: ${runId}`);
  }
  return stem;
}

async function writeFinalArtifacts(
  outputDirectory: string,
  materialized: ReturnType<typeof finalizeBenchmarkReview>
): Promise<void> {
  const output = resolve(outputDirectory);
  if (await exists(output)) {
    throw new Error(`final review output already exists: ${output}`);
  }
  const parent = dirname(output);
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(join(parent, ".agentcarry-final-review-"));
  let moved = false;
  try {
    const assessmentDirectory = join(temporary, "assessments");
    const scoreDirectory = join(temporary, "scores");
    await Promise.all([
      mkdir(assessmentDirectory),
      mkdir(scoreDirectory)
    ]);
    await Promise.all(materialized.assessments.flatMap((assessment, index) => {
      const score = materialized.scores[index]!;
      const stem = artifactStem(assessment.runId);
      return [
        writeFile(join(assessmentDirectory, `${stem}.json`), canonicalJson(assessment), "utf8"),
        writeFile(join(scoreDirectory, `${stem}.json`), renderScoreJson(score), "utf8"),
        writeFile(join(scoreDirectory, `${stem}.md`), renderScoreMarkdown(score), "utf8")
      ];
    }));
    await Promise.all([
      writeFile(
        join(temporary, "human-review.json"),
        canonicalJson(materialized.confirmation),
        "utf8"
      ),
      writeFile(join(temporary, "result-set.json"), canonicalJson(materialized.resultSet), "utf8"),
      writeFile(join(temporary, "report.json"), renderAggregateJson(materialized.report), "utf8"),
      writeFile(join(temporary, "REPORT.md"), renderAggregateMarkdown(materialized.report), "utf8")
    ]);
    await rename(temporary, output);
    moved = true;
  } finally {
    if (!moved) {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args.shift();
  const fixtureDirectory = args.shift();
  const runDirectory = args.shift();
  const output = option(args, "--output");
  if (
    (command !== "packet" && command !== "finalize")
    || fixtureDirectory === undefined
    || runDirectory === undefined
    || output === undefined
  ) {
    throw new Error(
      "Usage: review-benchmark packet <fixture-dir> <run-dir> --output <file>\n"
        + "   or: review-benchmark finalize <fixture-dir> <run-dir> --output <dir> "
        + "--reviewer <name> --reviewed-at <iso> --confirmation-source <url> --human-confirmed"
    );
  }
  const fixtures = await readFixtures(resolve(fixtureDirectory));
  const runRoot = resolve(runDirectory);
  const results = await readResults(runRoot);
  const advisory = await readJson(join(runRoot, "advisory-verdicts.json")) as AdvisoryVerdictSet;
  if (command === "packet") {
    const outputPath = resolve(output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, renderReviewPacket(fixtures, results, advisory), {
      encoding: "utf8",
      flag: "wx"
    });
    process.stdout.write(`${canonicalJson({ output: outputPath, runs: results.length })}`);
    return;
  }

  const reviewer = option(args, "--reviewer");
  const reviewedAt = option(args, "--reviewed-at");
  const confirmationSource = option(args, "--confirmation-source");
  if (
    !args.includes("--human-confirmed")
    || reviewer === undefined
    || reviewedAt === undefined
    || confirmationSource === undefined
  ) {
    throw new Error("finalization requires all human confirmation flags");
  }
  const materialized = finalizeBenchmarkReview(fixtures, results, advisory, {
    confirmed: true,
    humanReviewer: reviewer,
    reviewedAt,
    confirmationSource
  });
  await writeFinalArtifacts(output, materialized);
  process.stdout.write(canonicalJson({
    output: resolve(output),
    assessments: materialized.assessments.length,
    scores: materialized.scores.length,
    phase0Passed: materialized.report.phase0Passed
  }));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
