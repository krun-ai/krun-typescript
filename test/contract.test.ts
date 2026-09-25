/**
 * Offline contract tests: the SDK's hand-written models agree with the committed OpenAPI snapshot.
 *
 * When the API changes: `npm run check:openapi -- --update`, `npm run generate:openapi`, update
 * `OPENAPI_SHA256` / `OPENAPI_VERSION` in `src/constants.ts`, then fix whatever `tsc` and these tests report.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPENAPI_SHA256, OPENAPI_VERSION } from "../src/constants.js";
import { CODE_TO_CLASS } from "../src/errors.js";
import { Krun } from "../src/index.js";
import { decideBody, feedbackBody, SUPPORTED_ANSWER_TYPES } from "../src/wire.js";
import { canonicalSha256 } from "./canonical.js";
import { OPENAPI, schemaValidator } from "./mock-server.js";

const SCHEMAS = OPENAPI.components.schemas;
const DECIDE = OPENAPI.paths["/v1/decide"].post;
const props = (name: string) => Object.keys(SCHEMAS[name].properties).sort();
const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

describe("OpenAPI snapshot", () => {
  it("matches the pinned hash and version", () => {
    const snapshot = JSON.parse(readFileSync(new URL("../openapi/openapi.json", import.meta.url), "utf8"));
    expect(canonicalSha256(snapshot)).toBe(OPENAPI_SHA256);
    expect(OPENAPI.info.version).toBe(OPENAPI_VERSION);
  });

  it("has the endpoints the SDK uses", () => {
    expect(OPENAPI.paths["/v1/decide"].post).toBeDefined();
    expect(OPENAPI.paths["/v1/feedback"].post).toBeDefined();
    expect(OPENAPI.paths["/v1/models"].get).toBeDefined();
    expect(DECIDE.parameters.map((p: { name: string }) => p.name)).toContain("X-Request-ID");
  });

  it("maps every error code", () => {
    expect([...SCHEMAS.ErrorCode.enum].sort()).toEqual(Object.keys(CODE_TO_CLASS).sort());
    expect(props("ErrorDetail")).toEqual(["code", "message", "request_id"]);
  });

  const variant = (union: string, tag: string): string => {
    const ref: string = SCHEMAS[union].discriminator.mapping[tag];
    const name = ref.split("/").pop() as string;
    expect(SCHEMAS[union].oneOf).toContainEqual({ $ref: ref });
    expect(SCHEMAS[name].properties.type.enum).toEqual([tag]);
    expect(SCHEMAS[name].required).toContain("type");
    return name;
  };

  it("agrees on answers, usage and question types", () => {
    expect(Object.keys(SCHEMAS.Answer.discriminator.mapping)).toEqual(SUPPORTED_ANSWER_TYPES);
    expect(Object.keys(SCHEMAS.Question.discriminator.mapping)).toEqual(["choice", "noul", "score"]);
    expect(props(variant("Answer", "choice")).map(camel).sort()).toEqual(
      ["abstain", "abstentionStatus", "choice", "confidence", "probabilities", "type"].sort(),
    );
    expect(SCHEMAS.ChoiceAnswer.required).not.toContain("choice");
    expect(props(variant("Answer", "noul"))).toEqual(["noul", "type"]);
    expect(props(variant("Answer", "score"))).toEqual(["confidence", "legend", "probabilities", "score", "type"]);
    expect(SCHEMAS.AbstentionStatus.enum).toEqual(["calibrated", "advisory"]);
    expect(SCHEMAS.TaskType.enum).toEqual(["intent", "tool"]);
    expect(props("Usage")).toEqual(["input_tokens"]);
    expect(props(variant("Question", "choice"))).toEqual(["options", "task_type", "type"]);
    expect(props(variant("Question", "noul"))).toEqual(["criteria", "instructions", "type"]);
    expect(props(variant("Question", "score"))).toEqual(["instructions", "levels", "type"]);
    expect(props("NoulCriteria")).toEqual(["false", "true"]);
    expect(props("DecideRequest")).toEqual(["context", "model", "questions"]);
    expect(props("FeedbackRequest")).toEqual([
      "correct",
      "expected",
      "expected_decision",
      "metadata",
      "question_id",
      "request_id",
    ]);
    expect(props("FeedbackResponse")).toEqual(["created_at", "id", "object", "question_id", "request_id"]);
    expect(props("Model")).toEqual(["id", "object", "status"]);
  });
});

describe("serialized requests validate against the schema", () => {
  it("decide", () => {
    const validate = schemaValidator("DecideRequest");
    const body = decideBody({
      context: "ctx",
      questions: {
        a: { type: "choice", options: { x: "", y: null } },
        b: { type: "choice", options: { x: "desc", y: "desc" }, taskType: "tool" },
        c: { type: "noul", instructions: "Is it?", criteria: { true: "yes" } },
        d: { type: "score", instructions: "How much?", levels: ["low", "mid", "high"] },
      },
      model: "krun-one-v0",
    });
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  });

  it("feedback", () => {
    const validate = schemaValidator("FeedbackRequest");
    for (const body of [
      feedbackBody({ requestId: "req_1", questionId: "a", correct: false, expectedDecision: "y", metadata: { k: 1 } }),
      feedbackBody({ requestId: "req_1", questionId: "a", correct: true }),
      feedbackBody({ requestId: "req_1", questionId: "c", correct: false, expected: { type: "noul", value: true } }),
      feedbackBody({ requestId: "req_1", questionId: "d", correct: false, expected: { type: "score", value: 2 } }),
    ]) {
      expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
    }
  });
});

describe("OpenAPI examples", () => {
  const requestExamples = DECIDE.requestBody.content["application/json"].examples;
  it.each(Object.keys(requestExamples))("request example %s round-trips", (name) => {
    const value = requestExamples[name].value;
    const questions = Object.fromEntries(
      Object.entries(value.questions as Record<string, Record<string, unknown>>).map(([id, q]) => {
        const { task_type, ...rest } = q;
        return [id, task_type === undefined ? rest : { ...rest, taskType: task_type }];
      }),
    );
    expect(decideBody({ context: value.context, questions } as never)).toEqual(value);
  });

  const responseExamples = DECIDE.responses["200"].content["application/json"].examples;
  it.each(Object.keys(responseExamples))("response example %s parses", async (name) => {
    const value = responseExamples[name].value;
    const fetchMock = (async () =>
      new Response(JSON.stringify(value), { headers: { "X-Request-ID": "req_ex" } })) as typeof fetch;
    const client = new Krun({ apiKey: "krun_test_x", fetch: fetchMock });
    const result = await client.decide({
      context: "x",
      questions: { q: { type: "choice", options: { a: "", b: "" } } },
    });
    expect(result.model).toBe(value.model);
    expect(result.usage.inputTokens).toBe(value.usage.input_tokens);
    for (const [id, a] of Object.entries(value.answers as Record<string, Record<string, unknown>>)) {
      const { abstention_status, ...rest } = a;
      const expected = abstention_status === undefined ? rest : { ...rest, abstentionStatus: abstention_status };
      expect((result.answers as Record<string, unknown>)[id]).toEqual(expected);
    }
  });
});
