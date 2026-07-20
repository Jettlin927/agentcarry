import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

describe("repository AgentCarry Skill", () => {
  it("has valid discovery metadata and no scaffolding placeholders", async () => {
    const skill = await readFile(`${repositoryRoot}skills/agentcarry/SKILL.md`, "utf8");

    expect(skill).toMatch(/^---\r?\nname: agentcarry\r?\ndescription: .+\r?\n---/);
    expect(skill).not.toContain("TODO");
    expect(skill).toContain("agentcarry doctor --json");
    expect(skill).toContain("agentcarry continue --to <target> --dry-run --json");
    expect(skill).toContain("ACTIVE_SESSION");
    expect(skill).toContain("could select an older idle session");
    expect(skill.indexOf("Mandatory current-task guard")).toBeLessThan(
      skill.indexOf("agentcarry doctor --json")
    );
    expect(skill).toMatch(/Never add\r?\n  `--force` automatically/);
  });

  it("documents only interactive, telemetry-disabled third-party installation", async () => {
    const docs = await readFile(`${repositoryRoot}docs/skill-installation.md`, "utf8");

    expect(docs).toContain("DISABLE_TELEMETRY");
    expect(docs).toContain("--skill agentcarry");
    expect(docs).not.toMatch(/\s--all(?:\s|`)/);
    expect(docs).not.toMatch(/\s--yes(?:\s|`)/);
    expect(docs).not.toMatch(/\s-y(?:\s|`)/);
    for (const path of [
      "~/.codex/skills/agentcarry/",
      "~/.claude/skills/agentcarry/",
      "~/.config/opencode/skills/agentcarry/",
      "~/.gemini/skills/agentcarry/",
      "~/.pi/agent/skills/agentcarry/"
    ]) {
      expect(docs).toContain(path);
    }
  });
});
