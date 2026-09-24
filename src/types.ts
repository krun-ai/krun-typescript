/**
 * Public request and response types.
 *
 * Question ids and option ids are whatever the caller chose: they are never renamed, validated against an enum or
 * re-ordered. When the `questions` object is written inline, TypeScript infers them, so `result.answers.department`
 * autocompletes and `answer.choice` is typed as the union of that question's option ids.
 */

/** `intent` (the API default) or `tool` (tool/function routing). */
export type TaskType = "intent" | "tool";

/**
 * `calibrated`: abstention was validated for this kind of question (intent, label-only options).
 * `advisory`: `abstain` is a hint, not a validated guarantee (tool routing, intents with descriptions).
 */
export type AbstentionStatus = "calibrated" | "advisory";

// ------------------------------------------------------------------------------------------------------- requests

/** A `choice` question: pick one of `options`. */
export interface ChoiceQuestion<OptionId extends string = string> {
  type: "choice";
  /** Option id → description (2–64 options). Use `""` or `null` for label-only options. */
  options: Record<OptionId, string | null>;
  /** `"tool"` for tool/function routing; defaults to `"intent"` on the API side. */
  taskType?: TaskType | null;
}

/** Every question type the API accepts. Only `choice` exists today. */
export type Question = ChoiceQuestion;

/** Question id → question (1–16). */
export type Questions = Record<string, Question>;

export interface DecideParams<Q extends Questions = Questions> {
  /** The text to decide on (1–8,000 characters). */
  context: string;
  /** Question id → question (1–16). */
  questions: Q;
  /** Optional model id (defaults to the API's default model). */
  model?: string;
}

export interface FeedbackParams {
  /** `requestId` of the decision (`DecisionResult.requestId`). */
  requestId: string;
  /** Id of the question whose answer is reviewed. Always required, also for single-question requests. */
  questionId: string;
  /** Whether the answer was right. */
  correct: boolean;
  /** The option id that should have been chosen (≤ 200 characters). */
  expectedDecision?: string | null;
  /** Optional JSON object (≤ 8 KiB serialized). Do not put personal data here. */
  metadata?: Record<string, unknown> | null;
}

/** Per-call options. */
export interface RequestOptions {
  /** Override the client timeout (milliseconds) for this call. */
  timeout?: number;
  /** Abort the call. The abort reason is re-thrown as is. */
  signal?: AbortSignal;
}

export interface DecideOptions extends RequestOptions {
  /**
   * `X-Request-ID` to send (1–128 chars of `[A-Za-z0-9._:-]`); otherwise the API generates one. Either way it is
   * returned as `result.requestId`.
   */
  requestId?: string;
}

// ------------------------------------------------------------------------------------------------------ responses

/** The answer to one `choice` question. */
export interface ChoiceAnswer<OptionId extends string = string> {
  type: "choice";
  /**
   * Selected option id, or `null` when the model abstains. The SDK never replaces `null` with a best guess: the
   * ranking is still available in `probabilities`.
   */
  choice: OptionId | null;
  /**
   * Margin between the two most likely options: top-1 probability minus top-2 probability, in [0, 1].
   * It is the abstention score, NOT the probability that `choice` is correct.
   */
  confidence: number;
  /** Calibrated probability per option id, keyed exactly as sent, in request order. */
  probabilities: Record<OptionId, number>;
  /** True when `confidence` is below the model's abstention threshold (then `choice` is `null`). */
  abstain: boolean;
  /** `calibrated` or `advisory` (see {@link AbstentionStatus}). */
  abstentionStatus: AbstentionStatus;
}

/** Every answer type the API returns. Only `choice` exists today. */
export type Answer = ChoiceAnswer;

/** The answer type for a question type. */
export type AnswerFor<Q extends Question> = ChoiceAnswer<Extract<keyof Q["options"], string>>;

/** Answers keyed by the question ids of the request. */
export type Answers<Q extends Questions = Questions> = { [K in keyof Q]: AnswerFor<Q[K]> };

export interface Usage {
  /**
   * Input tokens processed by the model, summed over the questions (each question is scored as its own sequence).
   * Krun scores options and generates no text, so there are no output tokens. `null` only if the backend did not
   * report it.
   */
  inputTokens: number | null;
}

/** Result of `decide()`: one answer per question, keyed by the question ids of the request, in request order. */
export interface DecisionResult<Q extends Questions = Questions> {
  model: string;
  answers: Answers<Q>;
  usage: Usage;
  /** Value of the `X-Request-ID` response header. Pass it to `feedback()`. */
  requestId: string;
}

/** Stored feedback, as returned by `feedback()`. */
export interface Feedback {
  id: string;
  object: string;
  requestId: string;
  questionId: string;
  createdAt: Date;
}

export interface Model {
  id: string;
  object: string;
  status: string;
}
