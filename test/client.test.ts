/** Unit tests: an injected `fetch` stands in for the network. */

import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APIConnectionError,
  APIError,
  APIResponseValidationError,
  APITimeoutError,
  AuthenticationError,
  type ChoiceQuestion,
  InferenceFailedError,
  InternalServerError,
  InvalidRequestError,
  Krun,
  KrunError,
  type KrunOptions,
  NotFoundError,
  QuotaExceededError,
  RateLimitError,
  ServiceUnavailableError,
  UpstreamTimeoutError,
  VERSION,
} from "../src/index.js";

const KEY = "krun_live_SECRETsecretSECRETsecret0123456";

const DEPARTMENT = {
  type: "choice",
  options: {
    shipping: "Shipping and delivery issues",
    returns: "Returns and refunds",
    billing: "Billing and payment issues",
  },
} satisfies ChoiceQuestion;

const DECIDE_OK = {
  model: "krun-one-v0",
  answers: {
    department: {
      type: "choice",
      choice: "returns",
      confidence: 0.9788,
      probabilities: { shipping: 0.0056, returns: 0.9866, billing: 0.0078 },
      abstain: false,
      abstention_status: "advisory",
    },
  },
  usage: { input_tokens: 52 },
};

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

function makeClient(handler: Handler, options: KrunOptions = {}): { client: Krun; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchMock = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (init.signal?.aborted) throw init.signal.reason;
    return await handler(url, init);
  }) as typeof fetch;
  return { client: new Krun({ apiKey: KEY, fetch: fetchMock, ...options }), seen };
}

function firstBody(seen: Seen[]): unknown {
  const first = seen[0];
  if (!first) throw new Error("no request was sent");
  return first.body;
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = { "X-Request-ID": "req_abc123" },
): Handler {
  return () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function apiError(
  status: number,
  code: string | null,
  message = "boom",
  requestId: string | null = "req_err1",
  headers: Record<string, string> = {},
): Handler {
  const detail: Record<string, unknown> = { message, request_id: requestId };
  if (code !== null) detail.code = code;
  return json({ error: detail }, status, { "X-Request-ID": "req_hdr", ...headers });
}

function sequence(...handlers: Handler[]): Handler {
  return (url, init) => {
    const next = handlers.shift();
    if (!next) throw new Error("no more scripted responses");
    return next(url, init);
  };
}

const networkError = (): Handler => () => {
  throw new TypeError("fetch failed", {
    cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
  });
};

const decide = (client: Krun) =>
  client.decide({ context: "Customer wants to return an item.", questions: { department: DEPARTMENT } });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ------------------------------------------------------------------------------------------ configuration / auth

describe("configuration and auth", () => {
  it("sends the auth header and default headers", async () => {
    const { client, seen } = makeClient(json(DECIDE_OK));
    await decide(client);
    const h = seen[0]?.headers;
    expect(h?.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(h?.get("content-type")).toBe("application/json");
    expect(h?.get("accept")).toBe("application/json");
    expect(h?.get("user-agent")).toBe(`krun-typescript/${VERSION}`);
    expect(h?.has("x-request-id")).toBe(false);
  });

  it("reads KRUN_API_KEY from the environment", async () => {
    vi.stubEnv("KRUN_API_KEY", "krun_live_fromenv");
    const { client, seen } = makeClient(json(DECIDE_OK), { apiKey: undefined as unknown as string });
    await decide(client);
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer krun_live_fromenv");
  });

  it("throws a clear error without an API key", () => {
    vi.stubEnv("KRUN_API_KEY", "");
    expect(() => new Krun()).toThrow(KrunError);
    expect(() => new Krun()).toThrow(/KRUN_API_KEY/);
  });

  it("uses the default base URL and allows an override", async () => {
    let { client, seen } = makeClient(json(DECIDE_OK));
    expect(client.baseUrl).toBe("https://api.krun.ai");
    await decide(client);
    expect(seen[0]?.url).toBe("https://api.krun.ai/v1/decide");
    ({ client, seen } = makeClient(json(DECIDE_OK), { baseUrl: "http://localhost:8080/" }));
    await decide(client);
    expect(seen[0]?.url).toBe("http://localhost:8080/v1/decide");
  });

  it("rejects invalid configuration", () => {
    expect(() => new Krun({ apiKey: KEY, baseUrl: "api.krun.ai" })).toThrow(RangeError);
    expect(() => new Krun({ apiKey: KEY, timeout: 0 })).toThrow(RangeError);
    expect(() => new Krun({ apiKey: KEY, timeout: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => new Krun({ apiKey: KEY, maxRetries: -1 })).toThrow(RangeError);
    expect(() => new Krun({ apiKey: KEY, maxRetries: 1.5 })).toThrow(RangeError);
  });

  it("defaults to a 70 s timeout and 1 retry", () => {
    const client = new Krun({ apiKey: KEY });
    expect(client.timeout).toBe(70_000);
    expect(client.maxRetries).toBe(1);
  });

  it("never exposes the API key", () => {
    const client = new Krun({ apiKey: KEY });
    for (const text of [
      inspect(client, { showHidden: true, depth: 5 }),
      String(client),
      JSON.stringify(client),
      Object.keys(client).join(","),
      Object.getOwnPropertyNames(client).join(","),
    ]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain("SECRET");
    }
    expect(String(client)).toBe('Krun(baseUrl="https://api.krun.ai", timeout=70000, maxRetries=1)');
  });

  it("keeps the API key and request content out of errors", async () => {
    const { client } = makeClient(apiError(401, "UNAUTHORIZED", "missing, invalid or revoked API key"));
    const err = await client
      .decide({ context: "secret context text", questions: { department: DEPARTMENT } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    const text = `${String(err)} ${inspect(err, { depth: 5 })} ${JSON.stringify(err)}`;
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("secret context text");
    expect(text).not.toContain("Shipping and delivery");
  });

  it("is silent by default", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    const { client } = makeClient(json(DECIDE_OK));
    await decide(client);
    await makeClient(apiError(400, "INVALID_REQUEST"))
      .client.models()
      .catch(() => undefined);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------- decide

describe("decide", () => {
  it("serializes a single question", async () => {
    const { client, seen } = makeClient(json(DECIDE_OK));
    await decide(client);
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.body).toEqual({
      context: "Customer wants to return an item.",
      questions: { department: DEPARTMENT },
    });
  });

  it("maps taskType to task_type and sends model and X-Request-ID", async () => {
    const { client, seen } = makeClient(json(DECIDE_OK));
    await client.decide(
      {
        context: "Find my meetings tomorrow.",
        questions: {
          tool: {
            type: "choice",
            taskType: "tool",
            options: { calendar_search: "Search calendar events", send_email: null },
          },
          label_only: { type: "choice", options: { billing: "", sales: "" } },
        },
        model: "krun-one-v0",
      },
      { requestId: "my-trace:42" },
    );
    expect(seen[0]?.body).toEqual({
      context: "Find my meetings tomorrow.",
      questions: {
        tool: {
          type: "choice",
          task_type: "tool",
          options: { calendar_search: "Search calendar events", send_email: null },
        },
        label_only: { type: "choice", options: { billing: "", sales: "" } },
      },
      model: "krun-one-v0",
    });
    expect(seen[0]?.headers.get("x-request-id")).toBe("my-trace:42");
  });

  it("preserves question and option ids and their order verbatim", async () => {
    const options = { transaction_charged_twice: "", "Card-Arrival.v2": "", "lost or stolen card": "", ñandú: "" };
    const { client, seen } = makeClient(json(DECIDE_OK));
    await client.decide({
      context: "x",
      questions: { zeta: { type: "choice", options }, Alpha_1: { type: "choice", options } },
    });
    const sent = (firstBody(seen) as { questions: Record<string, { options: object }> }).questions;
    expect(Object.keys(sent)).toEqual(["zeta", "Alpha_1"]);
    expect(Object.keys(sent.zeta?.options ?? {})).toEqual(Object.keys(options));
  });

  it("parses the response into camelCase fields", async () => {
    const { client } = makeClient(json(DECIDE_OK, 200, { "X-Request-ID": "req_0b7f7c5e" }));
    const result = await decide(client);
    expect(result).toEqual({
      model: "krun-one-v0",
      answers: {
        department: {
          type: "choice",
          choice: "returns",
          confidence: 0.9788,
          probabilities: { shipping: 0.0056, returns: 0.9866, billing: 0.0078 },
          abstain: false,
          abstentionStatus: "advisory",
        },
      },
      usage: { inputTokens: 52 },
      requestId: "req_0b7f7c5e",
    });
    expect(Object.keys(result.answers.department.probabilities)).toEqual(["shipping", "returns", "billing"]);
  });

  it("never exposes output tokens", async () => {
    const { client } = makeClient(json({ ...DECIDE_OK, usage: { input_tokens: 52, output_tokens: 7 } }));
    const result = await decide(client);
    expect(result.usage).toEqual({ inputTokens: 52 });
    expect(Object.keys(result.usage)).toEqual(["inputTokens"]);
  });

  it("allows input_tokens = null", async () => {
    const { client } = makeClient(json({ ...DECIDE_OK, usage: { input_tokens: null } }));
    expect((await decide(client)).usage.inputTokens).toBeNull();
  });

  it("keeps choice null when the model abstains", async () => {
    const body = {
      model: "krun-one-v0",
      answers: {
        intent: {
          type: "choice",
          choice: null,
          confidence: 0.02,
          probabilities: { a: 0.49, b: 0.47, c: 0.04 },
          abstain: true,
          abstention_status: "calibrated",
        },
      },
      usage: { input_tokens: 30 },
    };
    const { client } = makeClient(json(body));
    const result = await client.decide({
      context: "x",
      questions: { intent: { type: "choice", options: { a: "", b: "", c: "" } } },
    });
    expect(result.answers.intent.abstain).toBe(true);
    expect(result.answers.intent.choice).toBeNull();
    expect(result.answers.intent.abstentionStatus).toBe("calibrated");
  });

  it("answers multiple questions in one call", async () => {
    const answer = (choice: string, probabilities: Record<string, number>, status: string) => ({
      type: "choice",
      choice,
      confidence: 0.5,
      probabilities,
      abstain: false,
      abstention_status: status,
    });
    const body = {
      model: "krun-one-v0",
      answers: {
        department: answer("returns", { shipping: 0.1, returns: 0.8, billing: 0.1 }, "advisory"),
        priority: answer("normal", { low: 0.2, normal: 0.7, high: 0.1 }, "advisory"),
        risk: answer("low", { low: 0.9, high: 0.1 }, "calibrated"),
      },
      usage: { input_tokens: 150 },
    };
    const { client, seen } = makeClient(json(body));
    const result = await client.decide({
      context: "x",
      questions: {
        department: DEPARTMENT,
        priority: { type: "choice", options: { low: "Can wait", normal: "", high: null } },
        risk: { type: "choice", options: { low: "", high: "" } },
      },
    });
    expect(seen).toHaveLength(1);
    expect(Object.keys((firstBody(seen) as { questions: object }).questions)).toEqual([
      "department",
      "priority",
      "risk",
    ]);
    expect(Object.keys(result.answers)).toEqual(["department", "priority", "risk"]);
    expect(result.answers.priority.choice).toBe("normal");
    expect(result.answers.risk.abstentionStatus).toBe("calibrated");
  });

  it("exposes advisory abstention for tool routing", async () => {
    const body = {
      model: "krun-one-v0",
      answers: {
        tool: {
          type: "choice",
          choice: "calendar_search",
          confidence: 0.965866,
          probabilities: { calendar_search: 0.982933, send_email: 0.017067 },
          abstain: false,
          abstention_status: "advisory",
        },
      },
      usage: { input_tokens: 41 },
    };
    const { client, seen } = makeClient(json(body));
    const result = await client.decide({
      context: "Find my meetings tomorrow.",
      questions: {
        tool: {
          type: "choice",
          taskType: "tool",
          options: { calendar_search: "Search calendar events", send_email: "Send an email" },
        },
      },
    });
    expect((firstBody(seen) as { questions: { tool: { task_type: string } } }).questions.tool.task_type).toBe("tool");
    expect(result.answers.tool.abstentionStatus).toBe("advisory");
  });

  it("falls back to the sent request id when the header is missing", async () => {
    const { client } = makeClient(json(DECIDE_OK, 200, {}));
    const result = await client.decide({ context: "x", questions: { department: DEPARTMENT } }, { requestId: "mine" });
    expect(result.requestId).toBe("mine");
  });

  it.each([
    ["not an object", []],
    ["no model", { answers: {}, usage: {} }],
    ["unknown answer type", { ...DECIDE_OK, answers: { d: { ...DECIDE_OK.answers.department, type: "score" } } }],
    ["bad confidence", { ...DECIDE_OK, answers: { d: { ...DECIDE_OK.answers.department, confidence: "high" } } }],
    ["bad choice", { ...DECIDE_OK, answers: { d: { ...DECIDE_OK.answers.department, choice: 3 } } }],
    ["fractional tokens", { ...DECIDE_OK, usage: { input_tokens: 1.5 } }],
  ])("rejects a malformed success response (%s)", async (_name, body) => {
    const { client } = makeClient(json(body));
    await expect(decide(client)).rejects.toBeInstanceOf(APIResponseValidationError);
  });

  it("rejects a non-JSON success response", async () => {
    const { client } = makeClient(() => new Response("<html>", { status: 200, headers: { "X-Request-ID": "req_1" } }));
    const err = await decide(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIResponseValidationError);
    expect((err as APIResponseValidationError).requestId).toBe("req_1");
  });

  it("checks argument types before any request", async () => {
    const { client, seen } = makeClient(json(DECIDE_OK));
    const bad = client as unknown as { decide: (p: unknown) => Promise<unknown> };
    await expect(bad.decide({ context: null, questions: { d: DEPARTMENT } })).rejects.toThrow(TypeError);
    await expect(bad.decide({ context: "x", questions: [DEPARTMENT] })).rejects.toThrow(TypeError);
    await expect(bad.decide({ context: "x", questions: { d: "billing" } })).rejects.toThrow(TypeError);
    expect(seen).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------- errors

describe("errors", () => {
  it.each([
    [400, "INVALID_REQUEST", InvalidRequestError],
    [400, "INVALID_OPTIONS", InvalidRequestError],
    [413, "PAYLOAD_TOO_LARGE", InvalidRequestError],
    [401, "UNAUTHORIZED", AuthenticationError],
    [404, "NOT_FOUND", NotFoundError],
    [429, "RATE_LIMITED", RateLimitError],
    [429, "QUOTA_EXCEEDED", QuotaExceededError],
    [502, "INFERENCE_FAILED", InferenceFailedError],
    [503, "UPSTREAM_UNAVAILABLE", ServiceUnavailableError],
    [504, "UPSTREAM_TIMEOUT", UpstreamTimeoutError],
    [500, "INTERNAL_ERROR", InternalServerError],
  ] as const)("maps %i %s", async (status, code, cls) => {
    const { client } = makeClient(apiError(status, code, "details here", "req_fromBody"), { maxRetries: 0 });
    const err = await decide(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(cls);
    expect(err).toBeInstanceOf(APIError);
    expect(err).toBeInstanceOf(KrunError);
    expect(err).toBeInstanceOf(Error);
    const e = err as APIError;
    expect(e.constructor).toBe(cls);
    expect(e.name).toBe(cls.name);
    expect(e.statusCode).toBe(status);
    expect(e.errorCode).toBe(code);
    expect(e.message).toBe("details here");
    expect(e.requestId).toBe("req_fromBody");
  });

  it("keeps rate limits and quotas distinct", () => {
    expect(new QuotaExceededError("q", { statusCode: 429 })).not.toBeInstanceOf(RateLimitError);
    expect(new RateLimitError("r", { statusCode: 429 })).not.toBeInstanceOf(QuotaExceededError);
  });

  it("falls back to the X-Request-ID header for the request id", async () => {
    const { client } = makeClient(apiError(400, "INVALID_REQUEST", "bad", null));
    const err = (await decide(client).catch((e: unknown) => e)) as InvalidRequestError;
    expect(err.requestId).toBe("req_hdr");
  });

  it("parses Retry-After", async () => {
    const { client } = makeClient(apiError(429, "RATE_LIMITED", "slow down", "r", { "Retry-After": "17" }));
    const err = (await decide(client).catch((e: unknown) => e)) as RateLimitError;
    expect(err.retryAfter).toBe(17);
  });

  it.each([
    [400, InvalidRequestError],
    [401, AuthenticationError],
    [404, NotFoundError],
    [429, RateLimitError],
    [500, InternalServerError],
    [502, APIError],
    [503, ServiceUnavailableError],
    [504, UpstreamTimeoutError],
    [418, APIError],
  ] as const)("maps %i without a code by status", async (status, cls) => {
    const { client } = makeClient(() => new Response("<html>proxy error</html>", { status }), { maxRetries: 0 });
    const err = (await client.models().catch((e: unknown) => e)) as APIError;
    expect(err.constructor).toBe(cls);
    expect(err.statusCode).toBe(status);
    expect(err.errorCode).toBeNull();
    expect(err.body).toBe("<html>proxy error</html>");
  });

  it("keeps an unknown error code and maps by status", async () => {
    const { client } = makeClient(apiError(400, "SOMETHING_NEW"));
    const err = (await client.models().catch((e: unknown) => e)) as APIError;
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect(err.errorCode).toBe("SOMETHING_NEW");
  });
});

// ------------------------------------------------------------------------------------------ retries and timeouts

describe("retries and timeouts", () => {
  // Make retry waits instant.
  const instantTimers = () => {
    const real = globalThis.setTimeout;
    const delays: number[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      if (ms !== undefined && ms < 60_000) {
        delays.push(ms);
        return real(fn, 0);
      }
      return real(fn, ms);
    }) as typeof setTimeout);
    return delays;
  };
  afterEach(() => vi.restoreAllMocks());

  it.each([502, 503, 504])("retries decide once on %i", async (status) => {
    instantTimers();
    const { client, seen } = makeClient(sequence(apiError(status, null), json(DECIDE_OK)));
    expect((await decide(client)).answers.department.choice).toBe("returns");
    expect(seen).toHaveLength(2);
  });

  it("honours Retry-After with a 10 s cap", async () => {
    const delays = instantTimers();
    let { client } = makeClient(
      sequence(apiError(503, "UPSTREAM_UNAVAILABLE", "x", "r", { "Retry-After": "5" }), json(DECIDE_OK)),
    );
    await decide(client);
    expect(delays).toContain(5000);
    ({ client } = makeClient(
      sequence(apiError(503, "UPSTREAM_UNAVAILABLE", "x", "r", { "Retry-After": "3600" }), json(DECIDE_OK)),
    ));
    await decide(client);
    expect(delays).toContain(10_000);
  });

  it("gives up after maxRetries", async () => {
    instantTimers();
    const { client, seen } = makeClient(apiError(503, "UPSTREAM_UNAVAILABLE"), { maxRetries: 2 });
    await expect(decide(client)).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(seen).toHaveLength(3);
  });

  it("retries a connection error", async () => {
    instantTimers();
    const { client, seen } = makeClient(sequence(networkError(), json(DECIDE_OK)));
    await decide(client);
    expect(seen).toHaveLength(2);
  });

  it("raises APIConnectionError after retries", async () => {
    instantTimers();
    const { client, seen } = makeClient(networkError());
    const err = await decide(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err).not.toBeInstanceOf(APITimeoutError);
    expect((err as Error).message).toContain("ECONNREFUSED");
    expect(seen).toHaveLength(2);
  });

  it.each([400, 401, 404, 429, 500])("does not retry %i", async (status) => {
    instantTimers();
    const { client, seen } = makeClient(apiError(status, null), { maxRetries: 3 });
    await expect(decide(client)).rejects.toBeInstanceOf(APIError);
    expect(seen).toHaveLength(1);
  });

  it("maxRetries: 0 disables retries", async () => {
    const { client, seen } = makeClient(apiError(503, null), { maxRetries: 0 });
    await expect(decide(client)).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(seen).toHaveLength(1);
  });

  it("times out, and does not retry a timeout", async () => {
    const hang: Handler = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    const { client, seen } = makeClient(hang, { timeout: 50, maxRetries: 3 });
    const err = await decide(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APITimeoutError);
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(seen).toHaveLength(1);
  });

  it("accepts a per-call timeout", async () => {
    const hang: Handler = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    const { client } = makeClient(hang);
    const start = Date.now();
    await expect(client.models({ timeout: 30 })).rejects.toBeInstanceOf(APITimeoutError);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("re-throws the caller's abort reason", async () => {
    const hang: Handler = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    const { client } = makeClient(hang);
    const controller = new AbortController();
    const reason = new Error("user cancelled");
    setTimeout(() => controller.abort(reason), 10);
    await expect(client.models({ signal: controller.signal })).rejects.toBe(reason);
  });

  it("never retries feedback", async () => {
    instantTimers();
    for (const handler of [apiError(503, "UPSTREAM_UNAVAILABLE"), networkError()]) {
      const { client, seen } = makeClient(handler, { maxRetries: 5 });
      await expect(
        client.feedback({ requestId: "req_1", questionId: "department", correct: true }),
      ).rejects.toBeInstanceOf(KrunError);
      expect(seen).toHaveLength(1);
    }
  });

  it("retries models", async () => {
    instantTimers();
    const body = { object: "list", data: [{ id: "krun-one-v0", object: "model", status: "available" }] };
    const { client, seen } = makeClient(sequence(apiError(502, null), json(body)));
    expect((await client.models()).map((m) => m.id)).toEqual(["krun-one-v0"]);
    expect(seen).toHaveLength(2);
  });
});

// ----------------------------------------------------------------------------------------------- feedback / models

const FEEDBACK_OK = {
  id: "fb_123",
  object: "feedback",
  request_id: "req_abc",
  question_id: "department",
  created_at: "2026-09-24T12:34:56.123456789Z",
};

describe("feedback", () => {
  it("serializes and parses", async () => {
    const { client, seen } = makeClient(json(FEEDBACK_OK, 201));
    const fb = await client.feedback({
      requestId: "req_abc",
      questionId: "department",
      correct: false,
      expectedDecision: "billing",
      metadata: { ticket: "T-1", reviewer: { team: "support" } },
    });
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.url).toBe("https://api.krun.ai/v1/feedback");
    expect(seen[0]?.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(seen[0]?.body).toEqual({
      request_id: "req_abc",
      question_id: "department",
      correct: false,
      expected_decision: "billing",
      metadata: { ticket: "T-1", reviewer: { team: "support" } },
    });
    expect(fb).toEqual({
      id: "fb_123",
      object: "feedback",
      requestId: "req_abc",
      questionId: "department",
      createdAt: new Date("2026-09-24T12:34:56.123Z"),
    });
  });

  it("sends a minimal body", async () => {
    const { client, seen } = makeClient(json(FEEDBACK_OK, 201));
    await client.feedback({ requestId: "req_abc", questionId: "department", correct: true });
    expect(seen[0]?.body).toEqual({ request_id: "req_abc", question_id: "department", correct: true });
  });

  it("checks arguments before any request", async () => {
    const { client, seen } = makeClient(json(FEEDBACK_OK, 201));
    const bad = client as unknown as { feedback: (p: unknown) => Promise<unknown> };
    await expect(bad.feedback({ requestId: "", questionId: "d", correct: true })).rejects.toThrow(TypeError);
    await expect(bad.feedback({ requestId: "r", questionId: "d", correct: "yes" })).rejects.toThrow(TypeError);
    await expect(bad.feedback({ requestId: "r", questionId: "d", correct: true, metadata: ["x"] })).rejects.toThrow(
      TypeError,
    );
    expect(seen).toHaveLength(0);
  });

  it("maps NOT_FOUND", async () => {
    const { client } = makeClient(apiError(404, "NOT_FOUND", "no decision with this request_id", "req_fb"));
    const err = (await client
      .feedback({ requestId: "req_unknown", questionId: "department", correct: true })
      .catch((e: unknown) => e)) as NotFoundError;
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.requestId).toBe("req_fb");
  });
});

describe("models", () => {
  it("lists models", async () => {
    const body = { object: "list", data: [{ id: "krun-one-v0", object: "model", status: "available" }] };
    const { client, seen } = makeClient(json(body));
    expect(await client.models()).toEqual([{ id: "krun-one-v0", object: "model", status: "available" }]);
    expect(seen[0]?.method).toBe("GET");
    expect(seen[0]?.url).toBe("https://api.krun.ai/v1/models");
    expect(seen[0]?.headers.get("authorization")).toBe(`Bearer ${KEY}`);
  });
});
