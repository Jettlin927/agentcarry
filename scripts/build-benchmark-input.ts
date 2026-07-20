import { readFile } from "node:fs/promises";
import {
  buildDeterministicCapsule,
  buildVisibleTranscript,
  canonicalJson,
  type BenchmarkSourceFixture,
  type HandoffMode
} from "../src/benchmark/build-handoff-input.js";
import { runSourceAssisted } from "../src/benchmark/run-source-assisted.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fixturePath = args.shift();
  const modeIndex = args.indexOf("--mode");
  const modelIndex = args.indexOf("--model");
  const mode = modeIndex === -1 ? undefined : args[modeIndex + 1] as HandoffMode | undefined;
  const model = modelIndex === -1 ? undefined : args[modelIndex + 1];
  if (
    fixturePath === undefined
    || mode === undefined
    || !["visible-transcript", "deterministic-capsule", "source-assisted-capsule"].includes(mode)
    || (mode === "source-assisted-capsule" && model === undefined)
  ) {
    console.error(
      "Usage: build-benchmark-input <fixture.json> --mode <visible-transcript|deterministic-capsule|source-assisted-capsule> [--model <model>]"
    );
    process.exitCode = 2;
    return;
  }

  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as BenchmarkSourceFixture;
  const artifact = mode === "visible-transcript"
    ? buildVisibleTranscript(fixture)
    : mode === "deterministic-capsule"
      ? buildDeterministicCapsule(fixture)
      : await runSourceAssisted(fixture, model!);
  process.stdout.write(canonicalJson(artifact));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

