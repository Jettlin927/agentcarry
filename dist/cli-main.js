#!/usr/bin/env node
import { createAgentCarryHandlers } from "./application.js";
import { runCli } from "./cli.js";
import { createInterface } from "node:readline";
const maximumStdinLineBytes = 256 * 1024;
let input;
let lines;
async function readStdinLine() {
    if (input === undefined) {
        input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
        lines = input[Symbol.asyncIterator]();
    }
    const next = await lines.next();
    if (next.done) {
        throw new Error("stdin closed before one line was received");
    }
    if (Buffer.byteLength(next.value, "utf8") > maximumStdinLineBytes) {
        throw new Error(`stdin line exceeds ${maximumStdinLineBytes} UTF-8 bytes`);
    }
    return next.value;
}
function releaseStdin() {
    input?.close();
    input = undefined;
    lines = undefined;
}
try {
    process.exitCode = await runCli(process.argv.slice(2), {
        stdout: process.stdout,
        stderr: process.stderr,
        stdin: { readLine: readStdinLine, release: releaseStdin }
    }, createAgentCarryHandlers());
}
finally {
    releaseStdin();
}
