import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  aggregateBenchmark,
  renderAggregateJson,
  renderAggregateMarkdown,
  type BenchmarkResultSet
} from "../src/benchmark/aggregate-report.js";

const args = process.argv.slice(2);
const resultSetPath = args.shift();
const formatIndex = args.indexOf("--format");
const format = formatIndex === -1 ? "markdown" : args[formatIndex + 1];
if (resultSetPath === undefined || !["json", "markdown"].includes(format ?? "")) {
  process.stderr.write("Usage: aggregate-benchmark <result-set.json> [--format json|markdown]\n");
  process.exitCode = 2;
} else {
  const fixtureDirectory = new URL("../benchmark/fixtures/", import.meta.url);
  const fixtureIds = await Promise.all(
    (await readdir(fixtureDirectory))
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const fixture = JSON.parse(await readFile(new URL(name, fixtureDirectory), "utf8")) as { id: string };
        return fixture.id;
      })
  );
  const resultSet = JSON.parse(await readFile(resolve(resultSetPath), "utf8")) as BenchmarkResultSet;
  const report = aggregateBenchmark(resultSet, fixtureIds);
  process.stdout.write(format === "json" ? renderAggregateJson(report) : renderAggregateMarkdown(report));
}
