import { readFile } from "node:fs/promises";
import { claudeLauncherMetadata } from "../src/adapters/claude/target-launcher.js";
import { codexAdapterMetadata } from "../src/adapters/codex/source-reader.js";

const path = new URL("../docs/compatibility.md", import.meta.url);
const matrix = await readFile(path, "utf8");
const expected = [
  "| Codex | Local JSONL |",
  "| Claude Code | Planned | Dry-run + interactive |",
  ...codexAdapterMetadata.observedCodexVersions,
  ...claudeLauncherMetadata.observedClaudeVersions
];
const missing = expected.filter((value) => !matrix.includes(value));
if (missing.length > 0) {
  process.stderr.write(`Compatibility matrix is missing adapter metadata: ${missing.join(", ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`PASS compatibility matrix covers ${expected.length} adapter facts\n`);
}
