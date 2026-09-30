/**
 * The `Krun` client.
 *
 * Retry policy (deliberately conservative — the API already retries its model backend):
 *
 * - `decide()` and `models()`: up to `maxRetries` extra attempts (default 1) after a connection error or an HTTP
 *   502/503/504. The wait honours `Retry-After` (capped at 10 s), otherwise 0.5 s, 1 s, 2 s, ... A decision is
 *   read-only apart from usage accounting, so a retry can at worst count one extra decision.
 * - `feedback()` writes a row and the API has no idempotency key, so it is never retried.
 * - `assets.create()` creates a resource (no idempotency key either) and `assets.delete()` would answer
 *   `ASSET_NOT_FOUND` on a repeat that follows a lost response, so neither is retried. `assets.get()` is read-only and
 *   retried like `models()`.
 * - The SDK timeout (`APITimeoutError`) is never retried: `timeout` bounds the wait for an attempt, and a request
 *   that already took that long is not repeated behind the caller's back.
 */

import { API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from "./constants.js";
import {
  APIConnectionError,
  APIResponseValidationError,
  APITimeoutError,
  errorFromResponse,
  KrunError,
} from "./errors.js";
import type {
  Asset,
  AssetData,
  CreateAssetOptions,
  DecideOptions,
  DecideParams,
  DecisionResult,
  DeletedAsset,
  Feedback,
  FeedbackParams,
  Model,
  Questions,
  RequestOptions,
} from "./types.js";
import { VERSION } from "./version.js";
import {
  decideBody,
  feedbackBody,
  parseAsset,
  parseDecision,
  parseDeletedAsset,
  parseFeedback,
  parseModels,
} from "./wire.js";

export interface KrunOptions {
  /** `krun_live_...` key. Defaults to `process.env.KRUN_API_KEY` (Node). */
  apiKey?: string;
  /** API root. Defaults to `https://api.krun.ai`. */
  baseUrl?: string;
  /** Milliseconds to wait for each attempt (connection, headers and body). Default 70 000. */
  timeout?: number;
  /** Extra attempts for `decide()`/`models()` after connection errors or 502/503/504. Default 1. */
  maxRetries?: number;
  /** Custom `fetch` (proxies, instrumentation, tests). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_RETRY_AFTER_S = 10;
const USER_AGENT = `krun-typescript/${VERSION}`;

function envApiKey(): string | undefined {
  // Read defensively: `process` does not exist outside Node-compatible runtimes.
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[API_KEY_ENV];
}

function validateTimeout(timeout: unknown, name = "timeout"): number {
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
    throw new RangeError(`${name} must be a positive, finite number of milliseconds`);
  }
  return timeout;
}

function retryDelayMs(attempt: number, retryAfterS: number | null): number {
  if (retryAfterS !== null) return Math.min(retryAfterS, MAX_RETRY_AFTER_S) * 1000;
  return Math.min(500 * 2 ** attempt, 8000) + Math.random() * 100;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

interface Send {
  method: "GET" | "POST" | "DELETE";
  path: string;
  /** JSON body. */
  body?: unknown;
  /** Raw body sent as is with its own `Content-Type` (asset uploads). */
  raw?: { data: Blob | ArrayBuffer | ArrayBufferView; contentType: string } | undefined;
  requestId?: string | undefined;
  maxRetries: number;
  options?: RequestOptions | undefined;
}

type Sender = (req: Send) => Promise<{ data: unknown; requestId: string | null }>;

function isAssetData(data: unknown): data is AssetData {
  return (
    (typeof Blob !== "undefined" && data instanceof Blob) || data instanceof ArrayBuffer || ArrayBuffer.isView(data)
  );
}

function assetPath(assetId: string): string {
  if (typeof assetId !== "string" || assetId === "") throw new TypeError("assetId must be a non-empty string");
  return `/v1/assets/${encodeURIComponent(assetId)}`;
}

/**
 * Media files referenced by image / document / audio content parts (`client.assets`).
 *
 * Krun One V1 (upcoming): not yet available on api.krun.ai.
 */
export class Assets {
  readonly #send: Sender;
  readonly #maxRetries: () => number;

  /** @internal Created by `Krun`. */
  constructor(send: Sender, maxRetries: () => number) {
    this.#send = send;
    this.#maxRetries = maxRetries;
  }

  /**
   * Upload a file: the bytes are the request body and `mimeType` its `Content-Type`. Never retried.
   *
   * ```ts
   * const asset = await client.assets.create(await readFile("invoice.pdf"), { mimeType: "application/pdf" });
   * await client.decide({ context: [{ type: "document", assetId: asset.id }], questions: {...} });
   * ```
   */
  async create(data: AssetData, options: CreateAssetOptions = {}): Promise<Asset> {
    if (!isAssetData(data)) throw new TypeError("data must be a Blob, an ArrayBuffer or a typed array (e.g. Buffer)");
    const blobType = typeof Blob !== "undefined" && data instanceof Blob ? data.type : "";
    const mimeType = options.mimeType ?? blobType;
    if (typeof mimeType !== "string" || mimeType === "") {
      throw new TypeError('mimeType is required (e.g. { mimeType: "image/png" }) unless data is a Blob with a type');
    }
    const { data: body } = await this.#send({
      method: "POST",
      path: "/v1/assets",
      raw: { data, contentType: mimeType },
      maxRetries: 0,
      options,
    });
    return parseAsset(body);
  }

  /** Metadata of an asset uploaded by this project. */
  async get(assetId: string, options?: RequestOptions): Promise<Asset> {
    const path = assetPath(assetId);
    const { data } = await this.#send({ method: "GET", path, maxRetries: this.#maxRetries(), options });
    return parseAsset(data);
  }

  /** Delete an asset before it expires. Never retried. */
  async delete(assetId: string, options?: RequestOptions): Promise<DeletedAsset> {
    const path = assetPath(assetId);
    const { data } = await this.#send({ method: "DELETE", path, maxRetries: 0, options });
    return parseDeletedAsset(data);
  }
}

/**
 * Krun API client.
 *
 * ```ts
 * import { Krun } from "@krun-ai/sdk";
 *
 * const client = new Krun(); // reads KRUN_API_KEY
 * const result = await client.decide({ context: "...", questions: { department: { type: "choice", options: {...} } } });
 * ```
 */
export class Krun {
  readonly baseUrl: string;
  readonly timeout: number;
  readonly maxRetries: number;
  /** Media uploads for multimodal contexts (Krun One V1, upcoming: not yet available on api.krun.ai). */
  readonly assets: Assets;
  // True private fields: not enumerable, not in JSON.stringify, not in util.inspect / console.log.
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(options: KrunOptions = {}) {
    const apiKey = options.apiKey ?? envApiKey();
    if (!apiKey) {
      throw new KrunError(`No API key: pass { apiKey } or set the ${API_KEY_ENV} environment variable.`);
    }
    this.#apiKey = apiKey;
    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    if (!/^https?:\/\//.test(baseUrl)) throw new RangeError("baseUrl must start with https:// or http://");
    this.baseUrl = baseUrl;
    this.timeout = validateTimeout(options.timeout ?? DEFAULT_TIMEOUT_MS);
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new RangeError("maxRetries must be an integer >= 0");
    this.maxRetries = maxRetries;
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") throw new KrunError("No fetch implementation: use Node >= 20 or pass { fetch }.");
    this.#fetch = f;
    this.assets = new Assets(
      (req) => this.#send(req),
      () => this.maxRetries,
    );
  }

  /**
   * Answer one or more questions about `context` in a single call.
   *
   * ```ts
   * const result = await client.decide({
   *   context: "Customer wants to return an item.",
   *   questions: { department: { type: "choice", options: { returns: "Returns and refunds", billing: "" } } },
   * });
   * result.answers.department.choice; // "returns" | "billing" | null
   * ```
   */
  async decide<Q extends Questions>(params: DecideParams<Q>, options?: DecideOptions): Promise<DecisionResult<Q>> {
    const body = decideBody(params);
    const { data, requestId } = await this.#send({
      method: "POST",
      path: "/v1/decide",
      body,
      requestId: options?.requestId,
      maxRetries: this.maxRetries,
      options,
    });
    return parseDecision<Q>(data, requestId ?? options?.requestId ?? "");
  }

  /** Report whether the answer to `questionId` of decision `requestId` was correct. Never retried. */
  async feedback(params: FeedbackParams, options?: RequestOptions): Promise<Feedback> {
    const body = feedbackBody(params);
    const { data } = await this.#send({ method: "POST", path: "/v1/feedback", body, maxRetries: 0, options });
    return parseFeedback(data);
  }

  /** List the models available to this API key. */
  async models(options?: RequestOptions): Promise<Model[]> {
    const { data } = await this.#send({ method: "GET", path: "/v1/models", maxRetries: this.maxRetries, options });
    return parseModels(data);
  }

  toString(): string {
    return `Krun(baseUrl=${JSON.stringify(this.baseUrl)}, timeout=${this.timeout}, maxRetries=${this.maxRetries})`;
  }

  // ------------------------------------------------------------------------------------------------------ plumbing

  async #send(req: Send): Promise<{ data: unknown; requestId: string | null }> {
    const url = this.baseUrl + req.path;
    const timeout = req.options?.timeout === undefined ? this.timeout : validateTimeout(req.options.timeout);
    const userSignal = req.options?.signal;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    if (req.requestId !== undefined) headers["X-Request-ID"] = req.requestId;
    let payload: BodyInit | undefined;
    if (req.raw !== undefined) {
      headers["Content-Type"] = req.raw.contentType;
      payload = req.raw.data as BodyInit;
    } else if (req.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(req.body);
    }

    for (let attempt = 0; ; attempt++) {
      // One controller per attempt: aborted by our timeout or by the caller's signal.
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new APITimeoutError(`request to ${url} timed out after ${timeout} ms`));
      }, timeout);
      const onUserAbort = () => controller.abort(userSignal?.reason);
      if (userSignal?.aborted) onUserAbort();
      else userSignal?.addEventListener("abort", onUserAbort, { once: true });

      let response: Response;
      let text: string;
      try {
        response = await this.#fetch(url, {
          method: req.method,
          headers,
          body: payload ?? null,
          signal: controller.signal,
          redirect: "manual",
        });
        text = await response.text();
      } catch (err) {
        if (timedOut) throw new APITimeoutError(`request to ${url} timed out after ${timeout} ms`, { cause: err });
        if (userSignal?.aborted) throw userSignal.reason;
        if (attempt < req.maxRetries) {
          await sleep(retryDelayMs(attempt, null), userSignal);
          continue;
        }
        const detail = err instanceof Error ? `${err.message}${causeCode(err)}` : String(err);
        throw new APIConnectionError(`could not reach ${url}: ${detail}`, { cause: err });
      } finally {
        clearTimeout(timer);
        userSignal?.removeEventListener("abort", onUserAbort);
      }

      const requestId = response.headers.get("x-request-id");
      if (response.ok) {
        try {
          return { data: JSON.parse(text), requestId };
        } catch (err) {
          throw new APIResponseValidationError(
            `unexpected response from the Krun API: HTTP ${response.status} body is not JSON`,
            { statusCode: response.status, requestId, cause: err },
          );
        }
      }
      const error = errorFromResponse(response, text);
      if (RETRYABLE_STATUS.has(response.status) && attempt < req.maxRetries) {
        await sleep(retryDelayMs(attempt, error.retryAfter), userSignal);
        continue;
      }
      throw error;
    }
  }
}

/** Node's fetch reports the real reason (ECONNREFUSED, ENOTFOUND, ...) in `cause`. */
function causeCode(err: Error): string {
  const cause = err.cause as { code?: unknown; message?: unknown } | undefined;
  const detail = typeof cause?.code === "string" ? cause.code : cause?.message;
  return typeof detail === "string" && detail !== "" ? ` (${detail})` : "";
}
