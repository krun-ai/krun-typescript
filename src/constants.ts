/** Default API root. */
export const DEFAULT_BASE_URL = "https://api.krun.ai";

/** 180 s: a Krun One V1 cold start can take up to ~150 s (the API edge waits up to 150 s for the backend). */
export const DEFAULT_TIMEOUT_MS = 180_000;

/** Extra attempts for `decide()` / `models()` after connection errors or 502/503/504. `feedback()` never retries. */
export const DEFAULT_MAX_RETRIES = 1;

/** Environment variable read when no `apiKey` is passed. */
export const API_KEY_ENV = "KRUN_API_KEY";

/** Krun API major version this SDK speaks (the `/v1` path prefix). */
export const API_VERSION = "v1";

/**
 * `info.version` and SHA-256 of the canonical JSON (sorted keys, no whitespace) of `openapi/openapi.json`, the
 * snapshot of https://api.krun.ai/openapi.json this release was written against. `src/generated/openapi.ts` is
 * generated from it; `test/contract.test.ts` keeps these values in sync and `npm run check:openapi` detects drift.
 */
export const OPENAPI_VERSION = "1.0.0-beta";
export const OPENAPI_SHA256 = "ae96a4ebfca51f2f1e4c6f5101799e00457d901c15935bc33939f77bc9f37121";
