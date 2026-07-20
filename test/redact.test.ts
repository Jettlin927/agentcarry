import { describe, expect, it } from "vitest";
import { redactSensitive, scanSensitive } from "../src/security/redact.js";

describe("redactSensitive", () => {
  it("redacts high-confidence secrets without echoing them in findings", () => {
    const openAi = `sk-${"a".repeat(32)}`;
    const github = `ghp_${"b".repeat(32)}`;
    const source = { nested: [`Bearer ${"c".repeat(32)}`, openAi], github };

    const result = redactSensitive(source);
    const rendered = JSON.stringify(result);

    expect(rendered).not.toContain(openAi);
    expect(rendered).not.toContain(github);
    expect(result.findings).toEqual([
      { code: "BEARER_TOKEN", location: "/nested/0" },
      { code: "OPENAI_API_KEY", location: "/nested/1" },
      { code: "GITHUB_TOKEN", location: "/github" }
    ]);
    expect(result.value.nested[1]).toBe("[REDACTED:OPENAI_API_KEY]");
  });

  it("removes complete private-key blocks", () => {
    const privateKey = "-----BEGIN PRIVATE KEY-----\nsecret-material\n-----END PRIVATE KEY-----";

    const result = redactSensitive({ privateKey });

    expect(JSON.stringify(result.value)).not.toContain("secret-material");
    expect(result.findings).toEqual([{ code: "PRIVATE_KEY", location: "/privateKey" }]);
  });

  it("supports explicit one-shot sensitive allowance while retaining findings", () => {
    const token = `npm_${"d".repeat(32)}`;
    const result = redactSensitive({ token }, true);

    expect(result.value.token).toBe(token);
    expect(result.allowed).toBe(true);
    expect(scanSensitive(result.value)).toEqual([{ code: "NPM_TOKEN", location: "/token" }]);
  });
});

