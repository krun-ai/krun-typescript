# Krun TypeScript SDK

Official TypeScript SDK for the Krun API.

```bash
npm install @krun-ai/sdk
```

> **Not published yet.** `@krun-ai/sdk` is ready but not on npm (the `krun-ai` npm scope still has to be created).
> Until it is published, build from a checkout:
>
> ```bash
> git clone https://github.com/krun-ai/krun-typescript.git && cd krun-typescript
> npm ci && npm run build && npm pack      # then: npm install ./krun-ai-sdk-0.1.0.tgz
> ```

- ESM only, Node.js 20+ (uses the built-in `fetch`; no runtime dependencies)
- TypeScript types with inference: question ids and option ids from your request type the result
- Supports **Krun API v1** (`/v1/*`, OpenAPI `1.0.0-beta`)

## Quickstart

```ts
import { Krun } from "@krun-ai/sdk";

const client = new Krun({
  apiKey: process.env.KRUN_API_KEY!, // or new Krun() to read KRUN_API_KEY
});

const result = await client.decide({
  context: "Customer wants to return an item.",
  questions: {
    department: {
      type: "choice",
      options: {
        shipping: "Shipping and delivery issues",
        returns: "Returns and refunds",
        billing: "Billing and payment issues",
      },
    },
  },
});

const answer = result.answers.department;

console.log(answer.choice);        // "returns", or null if the model abstains
console.log(answer.confidence);    // 0.9788: top-1 minus top-2 probability
console.log(answer.probabilities); // { shipping: 0.0056, returns: 0.9866, billing: 0.0078 }
console.log(result.requestId);     // "req_...": pass it to feedback()
```

When `questions` is written inline, TypeScript infers the ids. `result.answers.department` autocompletes, and
`answer.choice` has type `"shipping" | "returns" | "billing" | null`. If you build questions at runtime (typed
`Questions`), ids fall back to `string`.

## Reading an answer

Every question gets one `ChoiceAnswer`:

| field | type | meaning |
|---|---|---|
| `type` | `"choice"` | question type (the only type today) |
| `choice` | `OptionId \| null` | selected option id, **`null` when `abstain` is true** |
| `confidence` | `number` | **top-1 probability − top-2 probability**, in [0, 1] |
| `probabilities` | `Record<OptionId, number>` | calibrated probability per option id, keys exactly as sent, in request order |
| `abstain` | `boolean` | `confidence` is below the model's abstention threshold |
| `abstentionStatus` | `"calibrated" \| "advisory"` | how much to trust `abstain` (below) |

**`confidence` is a margin, not "the probability that the answer is correct".** It measures how clearly the best
option beats the runner-up: `0.97` means a clear winner, `0.02` means a near tie. It is the score the abstention
threshold is applied to.

**`choice` can be `null`.** When the model abstains, `choice` is `null` and the SDK does **not** replace it with the
most likely option. The ranking is still in `probabilities` if you want a best guess:

```ts
if (answer.choice === null) {
  const [bestGuess] = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1])[0]!;
  routeToHuman(bestGuess);
} else {
  route(answer.choice);
}
```

**`abstentionStatus`**:

- `calibrated`: intent questions with label-only options (`""`/`null` descriptions). Abstention was validated for
  this setup.
- `advisory`: tool routing and options with descriptions. `abstain` is a hint, not a validated guarantee.

`result.usage.inputTokens` is the number of input tokens the model processed, summed over questions. Krun scores
options and does not generate text, so there are no output tokens.

Field names are camelCase in TypeScript (`requestId`, `abstentionStatus`, `inputTokens`, `taskType`). The SDK maps
them to the API's snake_case. Your question ids and option ids are never renamed.

## Multiple questions

Ask several questions about the same context in **one call**. Answers come back under the same ids, in request
order:

```ts
const result = await client.decide({
  context: "My card was charged twice and I need the money back today!",
  questions: {
    department: { type: "choice", options: { shipping: "", returns: "", billing: "" } },
    priority: { type: "choice", options: { low: "Can wait", normal: "", high: "Urgent" } },
    risk: { type: "choice", options: { low: "", high: "" } },
  },
});

result.answers.department.choice; // "billing"
result.answers.priority.choice;   // "high"
result.answers.risk.choice;
```

Limits (enforced by the API, reported as `InvalidRequestError` before any inference): 1–16 questions, 2–64 options
per question, `context` 1–8,000 characters. Option descriptions can be a string, `""` or `null` (label-only).
Question and option ids are yours: they are sent and returned verbatim (`transaction_charged_twice`,
`calendar_search`, ...).

## Tool routing

Set `taskType: "tool"` to pick a tool or function:

```ts
const result = await client.decide({
  context: "Find my meetings tomorrow.",
  questions: {
    tool: {
      type: "choice",
      taskType: "tool",
      options: {
        calendar_search: "Search calendar events",
        send_email: "Send an email",
      },
    },
  },
});

result.answers.tool.choice;           // "calendar_search"
result.answers.tool.abstentionStatus; // "advisory": tool abstention is a hint, keep your own fallback
```

## Feedback

Tell Krun whether an answer was right. `questionId` is always required:

```ts
await client.feedback({
  requestId: result.requestId,
  questionId: "department",
  correct: false,
  expectedDecision: "billing",
  metadata: { ticket: "T-1234" }, // optional JSON object, ≤ 8 KiB; no personal data
});
```

Feedback for a `requestId` this project never decided throws `NotFoundError`.

## Models

```ts
const models = await client.models();
// [{ id: "krun-one-v0", object: "model", status: "available" }]
```

## Configuration

```ts
const client = new Krun({
  apiKey: "krun_live_...",         // default: process.env.KRUN_API_KEY
  baseUrl: "http://localhost:8080", // default: https://api.krun.ai
  timeout: 70_000,                  // milliseconds per attempt (default 70 s)
  maxRetries: 1,                    // decide()/models() only (default 1)
  fetch: customFetch,               // optional: proxies, instrumentation, tests
});
```

Per call: `client.decide(params, { timeout, signal, requestId })`, `client.feedback(params, { timeout, signal })`,
`client.models({ timeout, signal })`. Aborting `signal` rejects with the signal's reason.

There is no synchronous API: every method returns a Promise.

### Timeouts

The default is **70 seconds** because a Serverless cold start can use most of the API's own 60-second deadline. The
timeout covers each attempt, including the response body. It cannot be disabled: `0` and `Infinity` are rejected.
When it elapses the SDK throws `APITimeoutError`.

### Retries

The API already retries its model backend, so the SDK retries only a little:

| call | retried on | default |
|---|---|---|
| `decide()`, `models()` | connection errors, HTTP 502 / 503 / 504 | 1 retry (`maxRetries`) |
| `feedback()` | never: it writes a row and the API has no idempotency key | – |

- The wait between attempts follows `Retry-After` when the API sends it (capped at 10 s). Otherwise it is 0.5 s,
  then 1 s, 2 s, and so on.
- SDK timeouts (`APITimeoutError`) are not retried.
- 4xx errors and 500 are not retried.
- A retried `decide()` can count one extra decision against usage if the first attempt reached the model.
- Use `maxRetries: 0` to disable retries.

### Request IDs

Every decision gets an id from the `X-Request-ID` response header. The SDK puts it on `result.requestId`. Errors
carry it too (`error.requestId`, from the error body or the header), so you can quote it to support. You can send
your own with `decide(params, { requestId: "..." })` (1–128 characters of `[A-Za-z0-9._:-]`). The API keeps it and
returns it.

## Errors

All errors extend `KrunError` (itself an `Error`) and expose `message`, `requestId`, `statusCode` and `errorCode` when
available:

```text
KrunError
├── APIError                     the API answered with an error (statusCode always set)
│   ├── InvalidRequestError      400/413  INVALID_REQUEST, INVALID_OPTIONS, PAYLOAD_TOO_LARGE
│   ├── AuthenticationError      401      UNAUTHORIZED
│   ├── NotFoundError            404      NOT_FOUND
│   ├── RateLimitError           429      RATE_LIMITED       (.retryAfter)
│   ├── QuotaExceededError       429      QUOTA_EXCEEDED
│   ├── InferenceFailedError     502      INFERENCE_FAILED
│   ├── ServiceUnavailableError  503      UPSTREAM_UNAVAILABLE (.retryAfter)
│   ├── UpstreamTimeoutError     504      UPSTREAM_TIMEOUT
│   └── InternalServerError      500      INTERNAL_ERROR
├── APIConnectionError           no HTTP response (DNS, refused, reset, TLS)
│   └── APITimeoutError          the SDK timeout elapsed
└── APIResponseValidationError   a 2xx response did not match the contract
```

```ts
import { InvalidRequestError, KrunError, RateLimitError } from "@krun-ai/sdk";

try {
  await client.decide({ context: "...", questions });
} catch (err) {
  if (err instanceof InvalidRequestError) {
    console.error(err.errorCode, err.message, err.requestId); // INVALID_OPTIONS questions.q: 1 options given; ...
  } else if (err instanceof RateLimitError) {
    await sleep((err.retryAfter ?? 1) * 1000);
  } else if (err instanceof KrunError) {
    console.warn(`krun failed: ${err.name}: ${err.message}`);
  } else {
    throw err;
  }
}
```

Wrong argument types (e.g. `context: null` from untyped code) throw `TypeError` before any request is made.

## Privacy and logging

- No telemetry: the SDK sends requests only to the Krun API and records nothing itself. Usage is recorded by the
  API.
- Silent: the SDK never writes to the console.
- The API key is kept in a private class field. It never appears in `console.log(client)`, `JSON.stringify(client)`,
  `String(client)` or error messages.
- Requests carry `User-Agent: krun-typescript/<version>`.

## Examples

[`examples/`](examples/): `basic-decision.ts`, `multiple-questions.ts`, `tool-routing.ts`, `feedback.ts`,
`error-handling.ts`.

```bash
npm run build
export KRUN_API_KEY=krun_live_...
npx tsx examples/basic-decision.ts        # or, on Node 22.18+/23.6+: node examples/basic-decision.ts
```

## Development

```bash
npm ci
npm run lint          # Biome (lint + format check)
npm run typecheck     # tsc --noEmit (src, tests incl. compile-time type tests, examples)
npm test              # Vitest: unit + contract + mock-server integration (no network)
npm run build         # dist/: ESM .js + .d.ts + source maps
npm pack --dry-run    # inspect the package contents
npm run bench         # SDK overhead vs raw fetch on a local mock server
```

### Tests

- `test/client.test.ts`: unit tests with an injected `fetch`. Covers auth header, serialization, camelCase
  mapping, parsing, `choice: null`, `inputTokens`, `X-Request-ID`, the full error mapping, retries, timeouts, abort,
  base URL, feedback, models, key redaction and the absence of output tokens.
- `test/integration.test.ts`: real HTTP against `test/mock-server.ts`, a local server that validates every request
  body against the OpenAPI snapshot with Ajv. Covers real timeouts, connection refused and retry after 503.
- `test/contract.test.ts`: offline checks that the hand-written models match `openapi/openapi.json` (every error
  code mapped, fields, OpenAPI examples round-trip, pinned snapshot hash).
- `test/types.test.ts`: compile-time type inference checks (run by `npm run typecheck`).
- `test/live.test.ts`: **opt-in** production checks, never run in CI:

  ```bash
  KRUN_API_KEY=krun_live_... npm run test:live   # 1 real decision
  KRUN_API_KEY=krun_live_... npm run smoke       # manual smoke of the built package, 1 real decision
  ```

### OpenAPI contract and drift

The public API is hand-written, and `https://api.krun.ai/openapi.json` is the reference:

- `openapi/openapi.json` is the snapshot this release was written against. `src/generated/openapi.ts` is generated
  from it with `openapi-typescript` (`npm run generate:openapi`). It is internal and only types the wire format in
  `src/wire.ts`, so a breaking contract change fails `tsc`.
- The snapshot's version and hash are pinned in `src/constants.ts` and checked by `test/contract.test.ts`. The Python
  SDK pins the same hash.
- `npm run check:openapi` compares production with the snapshot. It exits 1 on drift and prints what changed.
  `-- --update` refreshes the snapshot.
- The `contract-drift` workflow runs that check weekly and on demand. The unit tests never use the network.

## Versioning and releases

SemVer, starting at `0.1.0`. SDK versions are independent of model versions (`krun-one-v0`) and of the API version
(v1). See [CHANGELOG.md](CHANGELOG.md).

Release flow (not yet executed):

1. Bump `version` in `package.json` and `src/version.ts`, and update `CHANGELOG.md`.
2. Merge to `main`. CI runs lint, typecheck, tests on Node 20/22/24, build and `npm pack --dry-run`.
3. Tag `vX.Y.Z` and publish a GitHub Release.
4. `.github/workflows/publish.yml` runs on the release. It checks that the tag matches the package version, runs
   the checks, and publishes with **npm Trusted Publishing** (OIDC, with provenance, no stored token).

One-time setup before the first release:

- Create the `krun-ai` npm organization.
- Configure the trusted publisher on npmjs.com (repo `krun-ai/krun-typescript`, workflow `publish.yml`, environment
  `npm`). npm only allows this on a package that already exists, so the very first `0.1.0` publish may have to be
  done once by hand (`npm publish --access public`) or with a short-lived granular token.
- Create the `npm` environment in the GitHub repo settings.

## License

[Apache License 2.0](LICENSE).
