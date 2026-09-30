# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-09-30

Krun One V1 is live on api.krun.ai (model `krun-one-v1`; `krun-one-v0` and `krun-one-v0.3` remain as aliases).
OpenAPI snapshot refreshed from production (same `info.version`, `1.0.0-beta`; only description texts changed).

- Default timeout raised from 70 s to **180 s** (`DEFAULT_TIMEOUT_MS = 180_000`): a Krun One V1 cold start can take
  up to ~150 s, and the API edge now waits up to 150 s for the backend.
- `krun-one-v1` is documented as the current default model; older model ids keep working.

- `decide({ context })`: `context` is `string` (unchanged: the request body is byte-identical) **or** an array of
  content parts, the discriminated union `ContentPart = TextPart | ImagePart | DocumentPart | AudioPart`
  (`{ type: "text", text, id? }`, `{ type: "image" | "document" | "audio", assetId, id? }`; `assetId` is sent as
  `asset_id`).
- New question type **`multi`** (`{ type: "multi", options, instructions? }`) and answer `MultiAnswer`
  (`{ type: "multi", values: string[], probabilities: Record<string, number> }`), typed by inference like `choice`.
- `client.assets.create(data, { mimeType })` (raw `Blob` / `ArrayBuffer` / `Uint8Array` / `Buffer` body with
  `Content-Type: mimeType`; defaults to `blob.type`), `client.assets.get(id)`, `client.assets.delete(id)`; `Asset`
  (`id`, `object`, `mimeType`, `sizeBytes`, `sha256`, `createdAt`, `expiresAt`) and `DeletedAsset`. `create()` and
  `delete()` are never retried; `get()` is retried like `models()`.
- New error codes mapped to the existing classes by HTTP status (`errorCode` tells them apart):
  `UNSUPPORTED_MODALITY`, `UNSUPPORTED_MIME_TYPE`, `ASSET_TOO_LARGE`, `TOO_MANY_IMAGES`, `TOO_MANY_DOCUMENTS`,
  `TOO_MANY_AUDIO`, `DOCUMENT_TOO_MANY_PAGES`, `AUDIO_TOO_LONG`, `DECODE_FAILED` → `InvalidRequestError`;
  `ASSET_NOT_FOUND`, `ASSET_EXPIRED` → `NotFoundError`; `ASSET_FORBIDDEN` → `PermissionDeniedError`; `OCR_FAILED`,
  `ASR_FAILED`, `VISION_FAILED` → `InferenceFailedError`; `MULTIMODAL_INFERENCE_FAILED` → `InternalServerError`.
  HTTP 410 / 415 without a code map to `NotFoundError` / `InvalidRequestError`.
- Typing note: `Answer` gains `MultiAnswer`, so exhaustive narrowing over `answer.type` needs a `"multi"` branch.
  Inline-typed questions are unaffected.

## [0.2.0] - 2026-09-28

Decision primitives (OpenAPI snapshot refreshed). First npm release (0.1.0 was never published to npm); 0.2.0 keeps
the version in step with the Python SDK.

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
