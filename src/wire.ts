/**
 * @internal Mapping between the public camelCase types and the snake_case wire format.
 *
 * Wire types come from `src/generated/openapi.ts` (generated from the OpenAPI snapshot), so a contract change that
 * breaks this mapping fails `tsc`. Only fixed field names are converted: question ids and option ids (map keys) are
 * copied verbatim.
 */

import { APIResponseValidationError } from "./errors.js";
import type { components } from "./generated/openapi.js";
import type {
  AbstentionStatus,
  Answer,
  ChoiceAnswer,
  DecideParams,
  DecisionResult,
  Feedback,
  FeedbackParams,
  Model,
  NoulAnswer,
  Question,
  Questions,
  ScoreAnswer,
} from "./types.js";

type Schemas = components["schemas"];
export type WireDecideRequest = Schemas["DecideRequest"];
export type WireQuestion = Schemas["Question"];
export type WireFeedbackRequest = Omit<Schemas["FeedbackRequest"], "metadata"> & {
  metadata?: Record<string, unknown> | null;
};

// ---------------------------------------------------------------------------------------------------- serialization

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function questionToWire(id: string, question: Question): WireQuestion {
  if (!isPlainObject(question)) {
    throw new TypeError(`questions[${JSON.stringify(id)}] must be an object like { type: "choice", options: {...} }`);
  }
  const { taskType, ...rest } = question as Question & { taskType?: "intent" | "tool" | null };
  const wire = { ...rest } as WireQuestion & Record<string, unknown>;
  if (taskType !== undefined) wire.task_type = taskType;
  if (Array.isArray(wire.levels)) wire.levels = [...wire.levels]; // order is semantic: copied as is
  return wire;
}

export function decideBody(params: DecideParams): WireDecideRequest {
  if (!isPlainObject(params)) throw new TypeError("decide() expects { context, questions }");
  const { context, questions, model } = params;
  if (typeof context !== "string") throw new TypeError(`context must be a string, got ${typeof context}`);
  if (!isPlainObject(questions)) {
    throw new TypeError("questions must be an object of question id -> question");
  }
  // Limits (1–16 questions, 2–64 options, ...) are enforced by the API, which answers InvalidRequestError before any
  // inference, so they never drift from the SDK.
  const wireQuestions: Record<string, WireQuestion> = {};
  for (const [id, question] of Object.entries(questions)) wireQuestions[id] = questionToWire(id, question);
  const body: WireDecideRequest = { context, questions: wireQuestions };
  if (model !== undefined && model !== null) body.model = model;
  return body;
}

export function feedbackBody(params: FeedbackParams): WireFeedbackRequest {
  if (!isPlainObject(params)) throw new TypeError("feedback() expects { requestId, questionId, correct }");
  const { requestId, questionId, correct, expected, expectedDecision, metadata } = params;
  if (typeof requestId !== "string" || requestId === "") {
    throw new TypeError("requestId must be a non-empty string (DecisionResult.requestId)");
  }
  if (typeof questionId !== "string" || questionId === "") throw new TypeError("questionId must be a non-empty string");
  if (typeof correct !== "boolean") throw new TypeError(`correct must be a boolean, got ${typeof correct}`);
  const body: WireFeedbackRequest = { request_id: requestId, question_id: questionId, correct };
  if (expected !== undefined && expected !== null) {
    if (!isPlainObject(expected) || !["choice", "noul", "score"].includes(String(expected.type))) {
      throw new TypeError('expected must be { type: "choice" | "noul" | "score", value }');
    }
    body.expected = { type: expected.type, value: expected.value } as NonNullable<WireFeedbackRequest["expected"]>;
  }
  if (expectedDecision !== undefined && expectedDecision !== null) body.expected_decision = expectedDecision;
  if (metadata !== undefined && metadata !== null) {
    if (!isPlainObject(metadata)) throw new TypeError("metadata must be a plain object");
    body.metadata = metadata;
  }
  return body;
}

// ---------------------------------------------------------------------------------------------------------- parsing

function fail(what: string): APIResponseValidationError {
  return new APIResponseValidationError(`unexpected response from the Krun API: ${what}`);
}

function obj(value: unknown, where: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw fail(`${where} is not an object`);
  return value;
}

function str(o: Record<string, unknown>, key: string, where: string): string {
  const value = o[key];
  if (typeof value !== "string") throw fail(`${where}.${key} is not a string`);
  return value;
}

function num(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw fail(`${where} is not a number`);
  return value;
}

function choiceAnswer(data: Record<string, unknown>, where: string): ChoiceAnswer {
  const choice = data.choice ?? null;
  if (choice !== null && typeof choice !== "string") throw fail(`${where}.choice is not a string or null`);
  if (typeof data.abstain !== "boolean") throw fail(`${where}.abstain is not a boolean`);
  const probabilities: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(data.probabilities, `${where}.probabilities`))) {
    probabilities[k] = num(v, `${where}.probabilities[${JSON.stringify(k)}]`);
  }
  return {
    type: "choice",
    choice,
    confidence: num(data.confidence, `${where}.confidence`),
    probabilities,
    abstain: data.abstain,
    abstentionStatus: str(data, "abstention_status", where) as AbstentionStatus,
  };
}

function numberMap(value: unknown, where: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(value, where))) out[k] = num(v, `${where}[${JSON.stringify(k)}]`);
  return out;
}

function noulAnswer(data: Record<string, unknown>, where: string): NoulAnswer {
  return { type: "noul", noul: num(data.noul, `${where}.noul`) };
}

function scoreAnswer(data: Record<string, unknown>, where: string): ScoreAnswer {
  const legend: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(data.legend, `${where}.legend`))) {
    if (typeof v !== "string") throw fail(`${where}.legend[${JSON.stringify(k)}] is not a string`);
    legend[k] = v;
  }
  return {
    type: "score",
    score: num(data.score, `${where}.score`),
    confidence: num(data.confidence, `${where}.confidence`),
    legend,
    probabilities: numberMap(data.probabilities, `${where}.probabilities`),
  };
}

// Answer parsers by `type`. A type this SDK does not know throws APIResponseValidationError ("please upgrade").
const ANSWER_PARSERS: Record<Schemas["Answer"]["type"], (data: Record<string, unknown>, where: string) => Answer> = {
  choice: choiceAnswer,
  noul: noulAnswer,
  score: scoreAnswer,
};

export const SUPPORTED_ANSWER_TYPES: readonly string[] = Object.keys(ANSWER_PARSERS);

export function parseDecision<Q extends Questions>(data: unknown, requestId: string): DecisionResult<Q> {
  const body = obj(data, "body");
  const answers: Record<string, Answer> = {};
  for (const [id, raw] of Object.entries(obj(body.answers, "answers"))) {
    const where = `answers[${JSON.stringify(id)}]`;
    const answer = obj(raw, where);
    const kind = answer.type;
    const parser =
      typeof kind === "string" && Object.hasOwn(ANSWER_PARSERS, kind)
        ? ANSWER_PARSERS[kind as Schemas["Answer"]["type"]]
        : undefined;
    if (!parser)
      throw fail(`${where}.type ${JSON.stringify(kind)} is not supported by this SDK version; please upgrade`);
    answers[id] = parser(answer, where);
  }
  const usage = obj(body.usage ?? {}, "usage");
  const tokens = usage.input_tokens ?? null;
  if (tokens !== null && !Number.isInteger(tokens)) throw fail("usage.input_tokens is not an integer");
  return {
    model: str(body, "model", "body"),
    answers: answers as DecisionResult<Q>["answers"],
    usage: { inputTokens: tokens as number | null },
    requestId,
  };
}

export function parseFeedback(data: unknown): Feedback {
  const body = obj(data, "body");
  const createdAtRaw = str(body, "created_at", "body");
  const createdAt = new Date(createdAtRaw);
  if (Number.isNaN(createdAt.getTime())) throw fail(`created_at ${JSON.stringify(createdAtRaw)} is not a timestamp`);
  return {
    id: str(body, "id", "body"),
    object: str(body, "object", "body"),
    requestId: str(body, "request_id", "body"),
    questionId: str(body, "question_id", "body"),
    createdAt,
  };
}

export function parseModels(data: unknown): Model[] {
  const body = obj(data, "body");
  if (!Array.isArray(body.data)) throw fail("data is not a list");
  return body.data.map((item, i) => {
    const m = obj(item, `data[${i}]`);
    return {
      id: str(m, "id", `data[${i}]`),
      object: str(m, "object", `data[${i}]`),
      status: str(m, "status", `data[${i}]`),
    };
  });
}
