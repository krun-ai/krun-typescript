/** KRUN-011 decision primitives: typed requests/answers, SDK parity fixture, and end-to-end against the mock API. */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APIResponseValidationError, InvalidRequestError, Krun } from "../src/index.js";
import { decideBody, feedbackBody } from "../src/wire.js";
import { MockKrunAPI } from "./mock-server.js";

const KEY = "krun_test_mockkey";
const CTX = "Customer says this is the third time exports failed and wants a human immediately.";
const PARITY = JSON.parse(readFileSync(new URL("./fixtures/decision_primitives_parity.json", import.meta.url), "utf8"));

describe("SDK parity fixture", () => {
  it("decide serializes exactly like the fixture (and the Python SDK)", () => {
    const body = decideBody({
      context: CTX,
      model: "krun-one-v0",
      questions: {
        department: { type: "choice", options: { billing: "Billing and payment issues", support: "", sales: null } },
        tool: {
          type: "choice",
          taskType: "tool",
          options: { create_ticket: "Open a support ticket", send_email: "Send an email" },
        },
        needs_human: {
          type: "noul",
          instructions: "Is the customer asking for human assistance?",
          criteria: { true: "Explicitly asks for a person", false: "Does not ask for a person" },
        },
        retry: { type: "noul", instructions: "Should the export be retried automatically?" },
        severity: {
          type: "score",
          instructions: "How severe is the reported issue?",
          levels: ["Minor issue", "Feature degraded", "Blocking issue"],
        },
      },
    });
    expect(body).toEqual(PARITY.wire);
    expect(JSON.stringify(Object.keys(body.questions))).toBe(JSON.stringify(Object.keys(PARITY.wire.questions)));
  });

  it("feedback serializes exactly like the fixture", () => {
    expect([
      feedbackBody({
        requestId: "req_parity",
        questionId: "needs_human",
        correct: false,
        expected: { type: "noul", value: false },
      }),
      feedbackBody({
        requestId: "req_parity",
        questionId: "severity",
        correct: false,
        expected: { type: "score", value: 2 },
      }),
      feedbackBody({ requestId: "req_parity", questionId: "department", correct: false, expectedDecision: "billing" }),
    ]).toEqual(PARITY.feedback);
  });
});

describe("primitives against the mock API", () => {
  let api: MockKrunAPI;
  let client: Krun;
  beforeEach(async () => {
    api = await new MockKrunAPI(KEY).start();
    client = new Krun({ apiKey: KEY, baseUrl: api.url, timeout: 5000 });
  });
  afterEach(async () => {
    await api.stop();
  });

  it("decodes mixed primitives into typed answers", async () => {
    const result = await client.decide({
      context: CTX,
      questions: {
        department: { type: "choice", options: { billing: "", support: "", sales: "" } },
        needs_human: { type: "noul", instructions: "Is the customer asking for human assistance?" },
        severity: {
          type: "score",
          instructions: "How severe is the reported issue?",
          levels: ["Minor issue", "Feature degraded", "Blocking issue"],
        },
      },
    });
    expect(Object.keys(result.answers)).toEqual(["department", "needs_human", "severity"]);
    expect(result.answers.department.choice).toBe("billing");
    expect(result.answers.needs_human.noul).toBe(0.973); // statically NoulAnswer: no narrowing needed
    expect(result.answers.severity.legend).toEqual({ 0: "Minor issue", 1: "Feature degraded", 2: "Blocking issue" });
    expect(Object.keys(result.answers.severity.probabilities)).toEqual(["0", "1", "2"]);
    expect(result.answers.severity.score).toBeCloseTo(1, 5);
    for (const answer of Object.values(result.answers)) {
      if (answer.type === "score") expect(answer.confidence).toBeGreaterThanOrEqual(0);
    }
  });

  it("maps a score level error to InvalidRequestError", async () => {
    await expect(
      client.decide({ context: CTX, questions: { s: { type: "score", instructions: "?", levels: ["only one"] } } }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
  });

  it("sends typed feedback", async () => {
    const r = await client.decide({ context: CTX, questions: { n: { type: "noul", instructions: "Urgent?" } } });
    const fb = await client.feedback({
      requestId: r.requestId,
      questionId: "n",
      correct: false,
      expected: { type: "noul", value: false },
    });
    expect(fb.questionId).toBe("n");
  });
});

describe("parsing", () => {
  const withBody = (body: unknown) =>
    new Krun({
      apiKey: "krun_test_x",
      fetch: (async () => new Response(JSON.stringify(body), { headers: { "X-Request-ID": "req_1" } })) as typeof fetch,
    });

  it("asks to upgrade on an unknown answer type", async () => {
    const client = withBody({ model: "m", answers: { q: { type: "rank", rank: 1 } }, usage: { input_tokens: 1 } });
    await expect(
      client.decide({ context: "x", questions: { q: { type: "noul", instructions: "?" } } }),
    ).rejects.toThrow(/upgrade/);
  });

  it("rejects a malformed score answer", async () => {
    const client = withBody({
      model: "m",
      answers: { q: { type: "score", score: 1, confidence: 0.5, legend: { 0: 1 }, probabilities: { 0: 1 } } },
      usage: { input_tokens: 1 },
    });
    await expect(
      client.decide({ context: "x", questions: { q: { type: "score", instructions: "?", levels: ["a", "b"] } } }),
    ).rejects.toBeInstanceOf(APIResponseValidationError);
  });

  it("rejects a bad expected value before sending", () => {
    expect(() =>
      feedbackBody({ requestId: "r", questionId: "q", correct: false, expected: { type: "rank", value: 1 } as never }),
    ).toThrow(TypeError);
  });
});
