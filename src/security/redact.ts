export interface SensitiveFinding {
  readonly code: string;
  readonly location: string;
}

export interface RedactionResult<T> {
  readonly value: T;
  readonly findings: readonly SensitiveFinding[];
  readonly allowed: boolean;
}

interface SensitivePattern {
  readonly code: string;
  readonly pattern: RegExp;
}

const sensitivePatterns: readonly SensitivePattern[] = [
  {
    code: "PRIVATE_KEY",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
  },
  { code: "ANTHROPIC_API_KEY", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { code: "OPENAI_API_KEY", pattern: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}\b/g },
  { code: "GITHUB_TOKEN", pattern: /\bgh[opusr]_[A-Za-z0-9]{20,}\b/g },
  { code: "NPM_TOKEN", pattern: /\bnpm_[A-Za-z0-9]{20,}\b/g },
  { code: "SLACK_TOKEN", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { code: "AWS_ACCESS_KEY_ID", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { code: "BEARER_TOKEN", pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}={0,2}\b/gi },
  { code: "CREDENTIAL_URL", pattern: /\bhttps?:\/\/[^\s/:]+:[^\s/@]+@[^\s]+/gi }
];

function pointer(parent: string, key: string | number): string {
  const segment = String(key).replaceAll("~", "~0").replaceAll("/", "~1");
  return `${parent}/${segment}`;
}

function transformString(
  value: string,
  location: string,
  findings: SensitiveFinding[],
  allowSensitive: boolean
): string {
  let transformed = value;
  for (const candidate of sensitivePatterns) {
    const matches = [...value.matchAll(candidate.pattern)];
    if (matches.length === 0) {
      continue;
    }
    findings.push({ code: candidate.code, location: location || "/" });
    if (!allowSensitive) {
      transformed = transformed.replace(candidate.pattern, `[REDACTED:${candidate.code}]`);
    }
  }
  return transformed;
}

function transform(
  value: unknown,
  location: string,
  findings: SensitiveFinding[],
  allowSensitive: boolean
): unknown {
  if (typeof value === "string") {
    return transformString(value, location, findings, allowSensitive);
  }
  if (Array.isArray(value)) {
    return value.map((nested, index) =>
      transform(nested, pointer(location, index), findings, allowSensitive)
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        transform(nested, pointer(location, key), findings, allowSensitive)
      ])
    );
  }
  return value;
}

export function redactSensitive<T>(value: T, allowSensitive = false): RedactionResult<T> {
  const findings: SensitiveFinding[] = [];
  const transformed = transform(value, "", findings, allowSensitive) as T;
  return {
    value: transformed,
    findings,
    allowed: allowSensitive
  };
}

export function scanSensitive(value: unknown): readonly SensitiveFinding[] {
  return redactSensitive(value, true).findings;
}

