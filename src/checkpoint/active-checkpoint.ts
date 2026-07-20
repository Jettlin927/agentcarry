import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import type {
  CanonicalSourceEvent,
  CapturedSource,
  SourceSession
} from "../adapters/source-reader.js";

export interface ActiveCheckpoint {
  readonly schemaVersion: "1.0.0";
  readonly currentUserMessage: string;
  readonly assistantCheckpoint: string;
}

export class ActiveCheckpointError extends Error {
  constructor(
    readonly code: "CHECKPOINT_INVALID" | "CHECKPOINT_MESSAGE_MISMATCH" | "CHECKPOINT_SESSION_NOT_ACTIVE",
    message: string
  ) {
    super(message);
    this.name = "ActiveCheckpointError";
  }
}

const schemaPath = fileURLToPath(
  new URL("../../schema/active-checkpoint.v1.schema.json", import.meta.url)
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function validationSummary(errors: readonly ErrorObject[]): string {
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`)
    .join("; ");
}

export function parseActiveCheckpoint(input: string): ActiveCheckpoint {
  let value: unknown;
  try {
    value = JSON.parse(input.replace(/^\uFEFF/, ""));
  } catch (error: unknown) {
    throw new ActiveCheckpointError(
      "CHECKPOINT_INVALID",
      `Active checkpoint is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!validate(value)) {
    throw new ActiveCheckpointError(
      "CHECKPOINT_INVALID",
      `Active checkpoint does not match schema: ${validationSummary(validate.errors ?? [])}`
    );
  }
  return value as ActiveCheckpoint;
}

function comparableUserMessage(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n$/, "");
}

export function attachActiveCheckpoint(
  session: SourceSession,
  captured: CapturedSource,
  input: string
): CapturedSource {
  if (session.activity !== "active") {
    throw new ActiveCheckpointError(
      "CHECKPOINT_SESSION_NOT_ACTIVE",
      `Session ${session.id} is ${session.activity}; active checkpoint mode only accepts confirmed active sessions`
    );
  }
  const checkpoint = parseActiveCheckpoint(input);
  const currentUserMessage = captured.events
    .filter((event) => event.kind === "user-message" && event.text !== undefined)
    .at(-1)?.text;
  if (
    currentUserMessage === undefined
    || comparableUserMessage(currentUserMessage) !== comparableUserMessage(checkpoint.currentUserMessage)
  ) {
    throw new ActiveCheckpointError(
      "CHECKPOINT_MESSAGE_MISMATCH",
      "Checkpoint currentUserMessage does not match the last complete native user message after terminal line-ending normalization"
    );
  }
  const checkpointHash = createHash("sha256")
    .update(input, "utf8")
    .digest("hex");
  const checkpointEvent: CanonicalSourceEvent = {
    id: `checkpoint-${checkpointHash.slice(0, 24)}`,
    kind: "agent-checkpoint",
    timestamp: captured.snapshot.capturedAt,
    locator: `checkpoint:stdin:${checkpointHash}`,
    text: checkpoint.assistantCheckpoint
  };
  return {
    ...captured,
    events: [...captured.events, checkpointEvent]
  };
}
