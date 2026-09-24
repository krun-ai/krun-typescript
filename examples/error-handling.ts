// Catching SDK errors. Every error carries message, statusCode, errorCode and requestId when available.
import {
  APITimeoutError,
  AuthenticationError,
  InvalidRequestError,
  Krun,
  KrunError,
  QuotaExceededError,
  RateLimitError,
  ServiceUnavailableError,
  UpstreamTimeoutError,
} from "@krun-ai/sdk";

const client = new Krun({ maxRetries: 1, timeout: 70_000 });

try {
  await client.decide({
    context: "Customer wants to return an item.",
    questions: { department: { type: "choice", options: { returns: "" } } }, // 1 option: invalid
  });
} catch (err) {
  if (err instanceof InvalidRequestError) {
    console.log(`invalid request [${err.errorCode}] ${err.message} (requestId=${err.requestId})`);
  } else if (err instanceof AuthenticationError) {
    console.log("check KRUN_API_KEY");
  } else if (err instanceof RateLimitError) {
    console.log(`slow down; retry in ${err.retryAfter}s`);
  } else if (err instanceof QuotaExceededError) {
    console.log("monthly quota exhausted");
  } else if (
    err instanceof UpstreamTimeoutError ||
    err instanceof ServiceUnavailableError ||
    err instanceof APITimeoutError
  ) {
    console.log(`model temporarily unavailable, try again later: ${err.message}`);
  } else if (err instanceof KrunError) {
    console.log(`other Krun error: ${err.name}: ${err.message}`);
  } else {
    throw err;
  }
}
