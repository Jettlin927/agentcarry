import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateFixture } from "../src/benchmark/validate-fixture.js";

function readJson(relativePath: string): unknown {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

describe("validateFixture", () => {
  it("accepts the minimal complete fixture", () => {
    const fixture = readJson("../benchmark/examples/minimal-debugging.json");

    expect(validateFixture(fixture)).toEqual({ valid: true, errors: [] });
  });

  it("rejects a fixture missing the next action", () => {
    const fixture = readJson("./fixtures/invalid-missing-next-action.json");
    const result = validateFixture(fixture);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "SCHEMA", location: "/groundTruth" })
    );
  });

  it("reports a secret location without echoing the value", () => {
    const fixture = readJson("../benchmark/examples/minimal-debugging.json") as {
      source: { events: Array<{ text: string }> };
    };
    const secret = `sk-${"x".repeat(32)}`;
    fixture.source.events[0]!.text = `Use ${secret}`;

    const result = validateFixture(fixture);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      code: "SENSITIVE_VALUE",
      location: "/source/events/0/text",
      message: "matched OPENAI_API_KEY"
    });
    expect(JSON.stringify(result.errors)).not.toContain(secret);
  });
});

