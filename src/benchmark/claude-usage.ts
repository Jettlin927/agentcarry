export interface ClaudeUsage {
  readonly input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

function tokenCount(value: number | undefined, field: string): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Claude result returned invalid ${field}`);
  }
  return value;
}

export function totalInputTokens(usage: ClaudeUsage | undefined): number {
  if (usage === undefined) {
    throw new Error("Claude result returned no token usage");
  }
  const fields = [
    usage.input_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_input_tokens
  ];
  if (fields.every((value) => value === undefined)) {
    throw new Error("Claude result returned no input token count");
  }
  return tokenCount(usage.input_tokens, "input_tokens")
    + tokenCount(usage.cache_creation_input_tokens, "cache_creation_input_tokens")
    + tokenCount(usage.cache_read_input_tokens, "cache_read_input_tokens");
}
