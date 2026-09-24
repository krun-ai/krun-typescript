# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

Initial SDK, licensed under Apache-2.0.

- `Krun` client for Krun API v1 (OpenAPI `1.0.0-beta`), ESM, Node.js 20+, native `fetch`, no runtime dependencies.
- `decide()`: context + 1–16 named `choice` questions, including tool routing (`taskType: "tool"`), returns
  `DecisionResult` (`model`, `answers`, `usage.inputTokens`, `requestId` from `X-Request-ID`), with question and
  option ids inferred from the request type.
- `feedback()` and `models()`.
- Error hierarchy mapped from the API's error codes, carrying `message`, `requestId`, `statusCode`, `errorCode`.
- 70 s default timeout; conservative retries (decide/models only, connection errors and 502/503/504, default 1).
- OpenAPI snapshot, generated internal wire types, contract tests and drift check.
