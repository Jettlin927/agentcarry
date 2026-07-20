# Security policy

## Supported versions

AgentCarry has not published a supported release yet. Security guarantees in the
design phase are test targets, not claims of production readiness.

## Reporting a vulnerability

Please use GitHub private vulnerability reporting when it becomes available for
this repository. Do not open a public issue containing secrets, local transcript
content, or a working exploit.

## Security invariants

- source sessions are read-only;
- no agent installation, authentication, or permission escalation;
- no default network upload or telemetry;
- high-confidence secrets are redacted before stdout, files, or target launch;
- `--allow-sensitive` is explicit, one-shot, and never stored as a default;
- active source sessions are rejected during v0.1;
- target command and loss receipt are shown before a non-dry-run launch;
- private native session files are never written directly.

The threat model and redaction tests will be tracked as public issues without
including real secrets.

Redaction findings contain only a stable finding code and JSON location. They do
not contain the matched value. Current high-confidence patterns cover common
provider/package tokens, AWS access key IDs, bearer tokens, credential-bearing
URLs, and complete private-key blocks.
