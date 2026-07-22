import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateWorkCapsule } from "../capsule/validate-capsule.js";
import { buildSourceAssistedPrompt, sourceAssistedArtifact } from "./build-handoff-input.js";
import { totalInputTokens } from "./claude-usage.js";
export async function defaultProcessRunner(command, args, options) {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: process.env,
            shell: false,
            stdio: ["pipe", "pipe", "pipe"]
        });
        const stdout = [];
        const stderr = [];
        child.stdout.on("data", (chunk) => stdout.push(chunk));
        child.stderr.on("data", (chunk) => stderr.push(chunk));
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({
            exitCode: exitCode ?? 1,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8")
        }));
        child.stdin.end(options.stdin, "utf8");
    });
}
export async function createSourceAssistedInvocation(fixture, model, options = {}) {
    const schemaPath = fileURLToPath(new URL("../../schema/work-capsule.v2.schema.json", import.meta.url));
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const schemaJson = JSON.stringify(schema);
    const settingSources = options.settingSources ?? "none";
    return {
        command: "claude",
        args: [
            "--print",
            "--no-session-persistence",
            "--tools",
            "",
            "--disable-slash-commands",
            "--strict-mcp-config",
            "--mcp-config",
            "{\"mcpServers\":{}}",
            "--permission-mode",
            "plan",
            "--setting-sources",
            settingSources === "none" ? "" : settingSources,
            "--output-format",
            "json",
            "--json-schema",
            schemaJson,
            "--model",
            model
        ],
        stdin: `${buildSourceAssistedPrompt(fixture)}

WORK CAPSULE V2 JSON SCHEMA
${schemaJson}
`,
        model,
        persistence: "disabled",
        tools: "disabled",
        settingSources
    };
}
export async function runSourceAssisted(fixture, model, runner = defaultProcessRunner, options = {}) {
    const invocation = await createSourceAssistedInvocation(fixture, model, options);
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "agentcarry-benchmark-"));
    try {
        const result = await runner(invocation.command, invocation.args, {
            cwd: temporaryDirectory,
            stdin: invocation.stdin
        });
        if (result.exitCode !== 0) {
            const details = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
            throw new Error(`source-assisted summarizer failed (${result.exitCode}): ${details}`);
        }
        const envelope = JSON.parse(result.stdout);
        const capsule = envelope.structured_output
            ?? (envelope.result === undefined ? undefined : JSON.parse(envelope.result));
        const inputTokens = totalInputTokens(envelope.usage);
        if (capsule === undefined) {
            throw new Error("source-assisted summarizer returned no structured output");
        }
        const schemaErrors = validateWorkCapsule(capsule);
        if (schemaErrors.length > 0) {
            const details = schemaErrors.slice(0, 5).map((error) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`).join("; ");
            throw new Error(`source-assisted summarizer returned invalid Work Capsule v2: ${details}`);
        }
        return sourceAssistedArtifact(fixture, model, capsule, inputTokens, invocation.stdin);
    }
    finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
}
