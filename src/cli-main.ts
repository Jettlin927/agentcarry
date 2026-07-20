#!/usr/bin/env node

import { createAgentCarryHandlers } from "./application.js";
import { runCli } from "./cli.js";
import { createInterface } from "node:readline";

const maximumCheckpointBytes = 256 * 1024;

async function readCheckpointLine(): Promise<string> {
  const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of input) {
      if (Buffer.byteLength(line, "utf8") > maximumCheckpointBytes) {
        throw new Error(`active checkpoint exceeds ${maximumCheckpointBytes} UTF-8 bytes`);
      }
      return line;
    }
  } finally {
    input.close();
  }
  throw new Error("active checkpoint stdin closed before one JSON line was received");
}

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: { readLine: readCheckpointLine }
}, createAgentCarryHandlers());

