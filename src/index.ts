/**
 * Official TypeScript SDK for the Krun API.
 *
 * @packageDocumentation
 */

export { Krun, type KrunOptions } from "./client.js";
export {
  API_VERSION,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
} from "./constants.js";
export {
  APIConnectionError,
  APIError,
  type APIErrorInit,
  APIResponseValidationError,
  APITimeoutError,
  AuthenticationError,
  ConflictError,
  type ErrorCode,
  InferenceFailedError,
  InsufficientCreditsError,
  InternalServerError,
  InvalidRequestError,
  KrunError,
  type KrunErrorInit,
  NotFoundError,
  PermissionDeniedError,
  QuotaExceededError,
  RateLimitError,
  ServiceUnavailableError,
  UpstreamTimeoutError,
} from "./errors.js";
export type {
  AbstentionStatus,
  Answer,
  AnswerFor,
  Answers,
  ChoiceAnswer,
  ChoiceQuestion,
  DecideOptions,
  DecideParams,
  DecisionResult,
  ExpectedAnswer,
  Feedback,
  FeedbackParams,
  Model,
  NoulAnswer,
  NoulCriteria,
  NoulQuestion,
  Question,
  Questions,
  QuestionType,
  RequestOptions,
  ScoreAnswer,
  ScoreQuestion,
  TaskType,
  Usage,
} from "./types.js";
export { VERSION } from "./version.js";
