/**
 * Official TypeScript SDK for the Krun API.
 *
 * @packageDocumentation
 */

export { Assets, Krun, type KrunOptions } from "./client.js";
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
  Asset,
  AssetData,
  AudioPart,
  ChoiceAnswer,
  ChoiceQuestion,
  ContentPart,
  ContentPartType,
  CreateAssetOptions,
  DecideOptions,
  DecideParams,
  DecisionResult,
  DeletedAsset,
  DocumentPart,
  ExpectedAnswer,
  Feedback,
  FeedbackParams,
  ImagePart,
  Model,
  MultiAnswer,
  MultiQuestion,
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
  TextPart,
  Usage,
} from "./types.js";
export { VERSION } from "./version.js";
