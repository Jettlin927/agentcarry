import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateFixture } from "../src/benchmark/validate-fixture.js";

interface BenchmarkFixture {
  readonly id: string;
  readonly archetype: string;
  readonly source: {
    readonly events: ReadonlyArray<{ readonly id: string; readonly kind: string }>;
  };
  readonly workspace: {
    readonly root: string;
    readonly files: ReadonlyArray<{ readonly path: string }>;
  };
  readonly groundTruth: Record<
    string,
    | { readonly evidenceRefs: readonly string[] }
    | ReadonlyArray<{ readonly evidenceRefs: readonly string[] }>
  >;
}

const fixtureDirectory = fileURLToPath(new URL("../benchmark/fixtures/", import.meta.url));

function readFixtures(): BenchmarkFixture[] {
  return readdirSync(fixtureDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) =>
      JSON.parse(readFileSync(`${fixtureDirectory}/${name}`, "utf8")) as BenchmarkFixture
    );
}

function evidenceRefs(fixture: BenchmarkFixture): string[] {
  return Object.values(fixture.groundTruth).flatMap((category) =>
    Array.isArray(category)
      ? category.flatMap((fact) => fact.evidenceRefs)
      : (category as { readonly evidenceRefs: readonly string[] }).evidenceRefs
  );
}

describe("controlled benchmark suite", () => {
  const fixtures = readFixtures();

  it("contains exactly three fixtures for each required archetype", () => {
    const counts = fixtures.reduce<Record<string, number>>((result, fixture) => {
      result[fixture.archetype] = (result[fixture.archetype] ?? 0) + 1;
      return result;
    }, {});

    expect(fixtures).toHaveLength(12);
    expect(counts).toEqual({
      "architecture-performance": 3,
      debugging: 3,
      "half-complete-feature": 3,
      "multi-file-refactor": 3
    });
    expect(new Set(fixtures.map((fixture) => fixture.id)).size).toBe(12);
  });

  it("passes schema, evidence-reference, and sensitive-value validation", () => {
    for (const fixture of fixtures) {
      expect(validateFixture(fixture), fixture.id).toEqual({ valid: true, errors: [] });
    }
  });

  it("distributes ground truth across early, late, and tool-result evidence", () => {
    for (const fixture of fixtures) {
      const refs = new Set(evidenceRefs(fixture));
      const firstEvent = fixture.source.events[0]!;
      const lastEvent = fixture.source.events.at(-1)!;
      const toolEventIds = fixture.source.events
        .filter((event) => event.kind === "tool-result")
        .map((event) => event.id);

      expect(refs.has(firstEvent.id), `${fixture.id} early evidence`).toBe(true);
      expect(refs.has(lastEvent.id), `${fixture.id} late evidence`).toBe(true);
      expect(
        toolEventIds.some((id) => refs.has(id)),
        `${fixture.id} tool-result evidence`
      ).toBe(true);
    }
  });

  it("covers Windows, POSIX, spaces, and non-ASCII paths", () => {
    const paths = fixtures.flatMap((fixture) => [
      fixture.workspace.root,
      ...fixture.workspace.files.map((file) => file.path)
    ]);

    expect(paths.some((path) => /^[A-Z]:\\/.test(path))).toBe(true);
    expect(paths.some((path) => path.startsWith("/"))).toBe(true);
    expect(paths.some((path) => path.includes(" "))).toBe(true);
    expect(paths.some((path) => /[^\x00-\x7F]/.test(path))).toBe(true);
  });
});
