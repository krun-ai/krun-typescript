/**
 * Error hierarchy.
 *
 *     KrunError
 *     ├── APIError                    the API answered with an error status
 *     │   ├── InvalidRequestError     400/413  INVALID_REQUEST, INVALID_OPTIONS, PAYLOAD_TOO_LARGE
 *     │   ├── AuthenticationError     401      UNAUTHORIZED
 *     │   ├── InsufficientCreditsError 402     INSUFFICIENT_CREDITS
 *     │   ├── PermissionDeniedError   403      FORBIDDEN, SIGNUP_RESTRICTED
 *     │   ├── NotFoundError           404      NOT_FOUND
 *     │   ├── ConflictError           409      CONFLICT
 *     │   ├── RateLimitError          429      RATE_LIMITED
 *     │   ├── QuotaExceededError      429      QUOTA_EXCEEDED
 *     │   ├── InferenceFailedError    502      INFERENCE_FAILED
 *     │   ├── ServiceUnavailableError 503      UPSTREAM_UNAVAILABLE
 *     │   ├── UpstreamTimeoutError    504      UPSTREAM_TIMEOUT
 *     │   └── InternalServerError     500      INTERNAL_ERROR
 *     ├── APIConnectionError          no HTTP response (DNS, refused, reset, TLS, ...)
 *     │   └── APITimeoutError         the SDK timeout elapsed
 *     └── APIResponseValidationError  a 2xx response did not match the contract
 *
 * Messages never contain the API key or request content.
 */

import type { components } from "./generated/openapi.js";

/** Stable error codes of the Krun API. */
export type ErrorCode = components["schemas"]["ErrorCode"];

export interface KrunErrorInit {
  requestId?: string | null;
  statusCode?: number | null;
  errorCode?: string | null;
  cause?: unknown;
}

/** Base class of every error thrown by the SDK. */
export class KrunError extends Error {
  /** Request id (from the error body or the `X-Request-ID` header), when known. */
  readonly requestId: string | null;
  /** HTTP status, when the API answered. */
  readonly statusCode: number | null;
  /** The API's stable error code (e.g. `INVALID_OPTIONS`), when the body had one. */
  readonly errorCode: string | null;

  constructor(message: string, init: KrunErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    this.requestId = init.requestId ?? null;
    this.statusCode = init.statusCode ?? null;
    this.errorCode = init.errorCode ?? null;
  }
}

export interface APIErrorInit extends KrunErrorInit {
  statusCode: number;
  body?: unknown;
  retryAfter?: number | null;
}

/** The API returned an error response. `statusCode` is always set. */
export class APIError extends KrunError {
  declare readonly statusCode: number;
  /** Parsed JSON error body, or the raw text when it was not JSON. */
  readonly body: unknown;
  /** Seconds from the `Retry-After` header, when present (rate limits, upstream unavailable). */
  readonly retryAfter: number | null;

  constructor(message: string, init: APIErrorInit) {
    super(message, init);
    this.body = init.body;
    this.retryAfter = init.retryAfter ?? null;
  }
}

/** The request was rejected before any inference (bad fields, 1 option, too many questions, body too big). */
export class InvalidRequestError extends APIError {}
/** Missing, invalid or revoked API key. */
export class AuthenticationError extends APIError {}
/** Unknown resource, e.g. feedback for a `requestId` this project never decided. */
export class NotFoundError extends APIError {}
/** The organization has no credits left (402). Retrying will not help until credits are added. */
export class InsufficientCreditsError extends APIError {}
/** The key is valid but not allowed to do this (FORBIDDEN, SIGNUP_RESTRICTED). */
export class PermissionDeniedError extends APIError {}
/** The request conflicts with the current state of a resource. */
export class ConflictError extends APIError {}
/** Per-key requests-per-minute limit reached. `retryAfter` says when the window resets. */
export class RateLimitError extends APIError {}
/** The project's monthly decision or input-token quota is exhausted. Retrying will not help. */
export class QuotaExceededError extends APIError {}
/** The model backend failed to produce a valid answer. */
export class InferenceFailedError extends APIError {}
/** The model backend is temporarily unavailable. */
export class ServiceUnavailableError extends APIError {}
/** The API's deadline for the model backend elapsed (e.g. a slow cold start). */
export class UpstreamTimeoutError extends APIError {}
/** Unexpected error inside the API. */
export class InternalServerError extends APIError {}

/** The request did not get an HTTP response. */
export class APIConnectionError extends KrunError {}
/** The SDK timeout elapsed before the response arrived. */
export class APITimeoutError extends APIConnectionError {}
/** A successful response did not have the documented shape (SDK/API version mismatch?). */
export class APIResponseValidationError extends KrunError {}

type APIErrorClass = new (message: string, init: APIErrorInit) => APIError;

/** @internal */
export const CODE_TO_CLASS: Record<ErrorCode, APIErrorClass> = {
  INVALID_REQUEST: InvalidRequestError,
  INVALID_OPTIONS: InvalidRequestError,
  PAYLOAD_TOO_LARGE: InvalidRequestError,
  UNAUTHORIZED: AuthenticationError,
  NOT_FOUND: NotFoundError,
  FORBIDDEN: PermissionDeniedError,
  SIGNUP_RESTRICTED: PermissionDeniedError,
  CONFLICT: ConflictError,
  INSUFFICIENT_CREDITS: InsufficientCreditsError,
  RATE_LIMITED: RateLimitError,
  QUOTA_EXCEEDED: QuotaExceededError,
  INFERENCE_FAILED: InferenceFailedError,
  UPSTREAM_UNAVAILABLE: ServiceUnavailableError,
  UPSTREAM_TIMEOUT: UpstreamTimeoutError,
  INTERNAL_ERROR: InternalServerError,
};

// Used when the body has no (known) code, e.g. an error page from a proxy in front of the API.
const STATUS_TO_CLASS: Record<number, APIErrorClass> = {
  400: InvalidRequestError,
  401: AuthenticationError,
  402: InsufficientCreditsError,
  403: PermissionDeniedError,
  404: NotFoundError,
  409: ConflictError,
  413: InvalidRequestError,
  422: InvalidRequestError,
  429: RateLimitError,
  500: InternalServerError,
  503: ServiceUnavailableError,
  504: UpstreamTimeoutError,
};

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  return Number.isFinite(secs) && secs >= 0 ? secs : null; // the Krun API only sends seconds
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** @internal Build the most specific `APIError` for an error response whose body was read as text. */
export function errorFromResponse(response: Response, text: string): APIError {
  const status = response.status;
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON: keep the text
  }
  let code: string | null = null;
  let message: string | null = null;
  let requestId: string | null = null;
  const detail = body !== null && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (detail !== null && typeof detail === "object") {
    const d = detail as Record<string, unknown>;
    code = stringOrNull(d.code);
    message = stringOrNull(d.message);
    requestId = stringOrNull(d.request_id);
  }
  const cls =
    (code !== null && Object.hasOwn(CODE_TO_CLASS, code) ? CODE_TO_CLASS[code as ErrorCode] : undefined) ??
    STATUS_TO_CLASS[status] ??
    APIError;
  return new cls(message ?? `HTTP ${status} ${response.statusText}`.trim(), {
    statusCode: status,
    requestId: requestId ?? response.headers.get("x-request-id"),
    errorCode: code,
    body,
    retryAfter: parseRetryAfter(response.headers.get("retry-after")),
  });
}
