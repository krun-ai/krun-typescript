# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - Unreleased

Decision primitives (OpenAPI snapshot refreshed). 0.1.0 was never published to npm; 0.2.0 keeps the version in step
with the Python SDK.

- New question types next to `choice`: **`noul`** (`{ type: "noul", instructions, criteria? }` → probability that
  a yes/no proposition holds) and **`score`** (`{ type: "score", instructions, levels }` → expected level +
  distribution over ordered levels). Types can be mixed in one `decide()` call.
- Answers are the discriminated union `ChoiceAnswer | NoulAnswer | ScoreAnswer`; with an inline `questions` object each
  answer is typed statically (`result.answers.severity.score`), otherwise narrow with `answer.type`.
- `feedback({ expected })`: typed expected value (`{ type: "noul", value: true }`, `{ type: "score", value: 2 }`,
  `{ type: "choice", value: "billing" }`). `expectedDecision` still works for choice.
- New error classes for codes the API already returns: `InsufficientCreditsError` (402), `PermissionDeniedError`,
  `ConflictError`.
- Typing note: `Answer` (and the answers of runtime-built `Questions`) is now a union; narrow with `answer.type` before
  reading `choice`. Inline-typed choice questions are unaffected.

## [0.1.0] - Unreleased (never published)

Initial SDK, licensed under Apache-2.0.

- `Krun` client for Krun API v1 (OpenAPI `1.0.0-beta`), ESM, Node.js 20+, native `fetch`, no runtime dependencies.
- `decide()`: context + 1–16 named `choice` questions, including tool routing (`taskType: "tool"`), returns
  `DecisionResult` (`model`, `answers`, `usage.inputTokens`, `requestId` from `X-Request-ID`), with question and
  option ids inferred from the request type.
- `feedback()` and `models()`.
- Error hierarchy mapped from the API's error codes, carrying `message`, `requestId`, `statusCode`, `errorCode`.
- 70 s default timeout; conservative retries (decide/models only, connection errors and 502/503/504, default 1).
- OpenAPI snapshot, generated internal wire types, contract tests and drift check.
