#!/usr/bin/env node

import { createAgentCarryHandlers } from "./application.js";
import { runCli } from "./cli.js";

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr
}, createAgentCarryHandlers());

