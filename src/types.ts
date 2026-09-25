/**
 * Public request and response types.
 *
 * Three decision primitives: `choice` (pick an option), `noul` (probability that a yes/no proposition holds) and
 * `score` (rate on ordered levels). Questions and answers are discriminated unions on `type`.
 *
 * Question ids, option ids and level order are whatever the caller chose: they are never renamed, validated against an
 * enum or re-ordered. When the `questions` object is written inline, TypeScript infers them, so
 * `result.answers.department` autocompletes, is typed as the answer of that question's type (`ChoiceAnswer`,
 * `NoulAnswer` or `ScoreAnswer`), and `answer.choice` is the union of that question's option ids.
 */

/** The decision primitive of a question (and of its answer). */
export type QuestionType = "choice" | "noul" | "score";

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

/** Optional texts for what makes a `noul` proposition true / false (either may be omitted). */
export interface NoulCriteria {
  true?: string;
  false?: string;
}

/** A `noul` question: the probability that a yes/no proposition about the context holds. */
export interface NoulQuestion {
  type: "noul";
  /** The proposition phrased as a yes/no question (1–1,000 characters), e.g. "Is the customer asking for a human?". */
  instructions: string;
  /** Optional description of what counts as true / false. */
  criteria?: NoulCriteria | null;
}

/** A `score` question: rate the context on ORDERED levels, lowest first. The order is sent exactly as given. */
export interface ScoreQuestion {
  type: "score";
  /** What to rate (1–1,000 characters), e.g. "How severe is the reported issue?". */
  instructions: string;
  /** 2–16 level descriptions, lowest first (1–500 characters each). */
  levels: readonly string[];
}

/** Every question type the API accepts, discriminated by `type`. */
export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion;

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

/** The correct answer of a question, for `feedback()`. */
export type ExpectedAnswer =
  | { type: "choice"; value: string }
  | { type: "noul"; value: boolean }
  | { type: "score"; value: number };

export interface FeedbackParams {
  /** `requestId` of the decision (`DecisionResult.requestId`). */
  requestId: string;
  /** Id of the question whose answer is reviewed. Always required, also for single-question requests. */
  questionId: string;
  /** Whether the answer was right. */
  correct: boolean;
  /**
   * The correct answer, typed like the question: `{ type: "choice", value: "billing" }`,
   * `{ type: "noul", value: true }` or `{ type: "score", value: 2 }` (level index).
   */
  expected?: ExpectedAnswer | null;
  /** Choice only, kept for compatibility: the option id that should have been chosen (≤ 200 characters). */
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

/** The answer to one `noul` question. */
export interface NoulAnswer {
  type: "noul";
  /**
   * Calibrated probability that the proposition holds, in [0, 1]: 0 = clearly false, 0.5 = uncertain, 1 = clearly
   * true. There is no separate confidence: the probability is the answer.
   */
  noul: number;
}

/** The answer to one `score` question. */
export interface ScoreAnswer {
  type: "score";
  /** Expected level: Σ level index × probability, in [0, levels − 1]. Not the most likely level. */
  score: number;
  /**
   * Concentration of the distribution, in [0, 1]: 1 − variance / maximum variance of the level index (1 = all
   * probability on one level, 0 = split between the lowest and the highest level).
   */
  confidence: number;
  /** Level index ("0", "1", ...) → the level text sent in the request. */
  legend: Record<string, string>;
  /** Level index → calibrated probability, in level order. */
  probabilities: Record<string, number>;
}

/** Every answer type the API returns, discriminated by `type`: narrow with `if (answer.type === "score")`. */
export type Answer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

/** The answer type for a question type. */
export type AnswerFor<Q extends Question> = Q extends ChoiceQuestion
  ? ChoiceAnswer<Extract<keyof Q["options"], string>>
  : Q extends NoulQuestion
    ? NoulAnswer
    : Q extends ScoreQuestion
      ? ScoreAnswer
      : Answer;

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
