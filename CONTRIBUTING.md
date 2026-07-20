# Contributing

AgentCarry is in pre-release design and benchmark work. Start with an issue for
behavior changes or new adapters.

## Workflow

1. One issue per independently verifiable change.
2. Create an `agent/<description>` branch.
3. Open a draft pull request early.
4. Add or update tests and sanitized fixtures.
5. Record relevant validation in the pull request.
6. Squash merge after CI and review.

## Adapter requirements

An official or community adapter in the core repository must include:

- supported agent and storage/CLI versions;
- which data-access tier it uses;
- sanitized fixtures for every supported event shape;
- read-only source-mutation tests for Readers;
- launch command/capability tests for Launchers;
- honest degradation behavior for unsupported versions.

AgentCarry does not promise same-day support for every upstream release. The
compatibility matrix is authoritative.

## Language and platforms

- code, schema, ADRs, and commit messages: English;
- user documentation: complete English and Simplified Chinese;
- CLI machine output: stable JSON;
- tests: Windows, macOS, and Ubuntu, including spaces and non-ASCII paths.

## Scope

Do not add agent installers, credential management, dashboards, cloud sync,
remote control, or general multi-agent orchestration without a new accepted ADR.

