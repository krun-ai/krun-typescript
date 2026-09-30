/** Contract/integration tests: real HTTP against `MockKrunAPI`, which validates requests with the OpenAPI snapshot. */

import { createServer } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APIConnectionError,
  APITimeoutError,
  AuthenticationError,
  InvalidRequestError,
  Krun,
  NotFoundError,
  ServiceUnavailableError,
} from "../src/index.js";
import { MockKrunAPI } from "./mock-server.js";

const KEY = "krun_test_mockkey";

const QUESTIONS = {
  department: {
    type: "choice",
    options: { shipping: "Shipping and delivery issues", returns: "Returns and refunds", billing: "" },
  },
  priority: { type: "choice", options: { low: "", normal: "", high: "" } },
  tool: {
    type: "choice",
    taskType: "tool",
    options: { calendar_search: "Search calendar events", send_email: null },
  },
} as const;

let api: MockKrunAPI;
let client: Krun;

beforeEach(async () => {
  api = await new MockKrunAPI(KEY).start();
  client = new Krun({ apiKey: KEY, baseUrl: api.url, timeout: 5000 });
});

afterEach(async () => {
  await api.stop();
});

describe("against the mock API", () => {
  it("decides end to end", async () => {
    const result = await client.decide({ context: "Customer wants to return an item.", questions: QUESTIONS });
    expect(Object.keys(result.answers)).toEqual(["department", "priority", "tool"]);
    expect(result.answers.department.choice).toBe("shipping");
    expect(result.answers.priority.abstentionStatus).toBe("calibrated");
    expect(result.answers.tool.abstentionStatus).toBe("advisory");
    expect(result.requestId).toMatch(/^req_/);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(api.requests[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("keeps choice null on abstain, with the ranking still visible", async () => {
    const result = await client.decide({
      context: "I am unsure what this is",
      questions: { intent: QUESTIONS.priority },
    });
    const answer = result.answers.intent;
    expect(answer.abstain).toBe(true);
    expect(answer.choice).toBeNull();
    const best = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1])[0]?.[0];
    expect(best).toBe("low");
  });

  it("echoes a client request id", async () => {
    const result = await client.decide(
      { context: "x", questions: { p: QUESTIONS.priority } },
      { requestId: "trace-123" },
    );
    expect(result.requestId).toBe("trace-123");
  });

  it("decides, then sends feedback", async () => {
    const result = await client.decide({ context: "x", questions: { department: QUESTIONS.department } });
    const fb = await client.feedback({
      requestId: result.requestId,
      questionId: "department",
      correct: false,
      expectedDecision: "billing",
      metadata: { source: "test" },
    });
    expect(fb.requestId).toBe(result.requestId);
    expect(fb.questionId).toBe("department");
    expect(fb.createdAt.getUTCFullYear()).toBe(2026);
  });

  it("lists models", async () => {
    expect((await client.models()).map((m) => [m.id, m.status])).toEqual([["krun-one-v0", "available"]]);
  });

  it("maps server-side validation errors", async () => {
    const err = (await client
      .decide({ context: "x", questions: { q: { type: "choice", options: { only: "" } } } })
      .catch((e: unknown) => e)) as InvalidRequestError;
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect(err.errorCode).toBe("INVALID_OPTIONS");
    expect(err.statusCode).toBe(400);
    expect(err.requestId).toMatch(/^req_/);
    // unknown field rejected by the OpenAPI schema
    const loose = { type: "choice", options: { a: "", b: "" }, extra: 1 } as unknown as typeof QUESTIONS.priority;
    await expect(client.decide({ context: "x", questions: { q: loose } })).rejects.toBeInstanceOf(InvalidRequestError);
  });

  it("maps a wrong key", async () => {
    const bad = new Krun({ apiKey: "krun_live_wrong", baseUrl: api.url });
    const err = (await bad.models().catch((e: unknown) => e)) as AuthenticationError;
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.statusCode).toBe(401);
    expect(err.errorCode).toBe("UNAUTHORIZED");
  });

  it("retries once after a 503", async () => {
    api.enqueue({
      status: 503,
      body: { error: { code: "UPSTREAM_UNAVAILABLE", message: "try later", request_id: "req_x" } },
      headers: { "Retry-After": "0" },
    });
    const result = await client.decide({ context: "x", questions: { p: QUESTIONS.priority } });
    expect(result.answers.p.choice).toBe("low");
    expect(api.requests).toHaveLength(2);
  });

  it("gives up after the default single retry", async () => {
    const err = {
      status: 503,
      body: { error: { code: "UPSTREAM_UNAVAILABLE", message: "down" } },
      headers: { "Retry-After": "0" },
    };
    api.enqueue(err, err);
    await expect(client.decide({ context: "x", questions: { p: QUESTIONS.priority } })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    expect(api.requests).toHaveLength(2);
  });

  it("times out for real and does not retry", async () => {
    api.enqueue({ status: 200, body: {}, delayMs: 1000 });
    const slow = new Krun({ apiKey: KEY, baseUrl: api.url, timeout: 200 });
    const start = Date.now();
    await expect(slow.decide({ context: "x", questions: { p: QUESTIONS.priority } })).rejects.toBeInstanceOf(
      APITimeoutError,
    );
    expect(Date.now() - start).toBeLessThan(900);
    expect(api.requests).toHaveLength(1);
  });

  it("reports connection refused", async () => {
    const port = await new Promise<number>((resolve) => {
      const s = createServer().listen(0, "127.0.0.1", () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => resolve(p));
      });
    });
    const dead = new Krun({ apiKey: KEY, baseUrl: `http://127.0.0.1:${port}`, maxRetries: 0 });
    const err = (await dead.models().catch((e: unknown) => e)) as APIConnectionError;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.message).not.toContain(KEY);
  });

  it("uploads an asset, decides on content parts with a multi question, then deletes it (Krun One V1)", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const asset = await client.assets.create(png, { mimeType: "image/png" });
    expect(asset.id).toMatch(/^asset_/);
    expect(asset.mimeType).toBe("image/png");
    expect(asset.sizeBytes).toBe(8);
    expect(asset.sha256).toBe("4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6");
    expect(asset.expiresAt.getTime() - asset.createdAt.getTime()).toBe(86_400_000);
    expect(api.requests[0]?.headers["content-type"]).toBe("image/png");
    expect(api.requests[0]?.bytes.equals(png)).toBe(true);
    expect(await client.assets.get(asset.id)).toEqual(asset);

    const result = await client.decide({
      context: [
        { type: "text", text: "Which elements are present?" },
        { type: "image", assetId: asset.id, id: "photo" },
      ],
      questions: {
        tags: { type: "multi", options: { logo: null, signature: "", stamp: "Official stamp" } },
        paid: { type: "noul", instructions: "Is it paid?" },
      },
    });
    expect(result.answers.tags.values).toEqual(["logo"]);
    expect(Object.keys(result.answers.tags.probabilities)).toEqual(["logo", "signature", "stamp"]);
    expect(result.answers.paid.noul).toBeGreaterThan(0.5);

    expect(await client.assets.delete(asset.id)).toEqual({ id: asset.id, object: "asset", deleted: true });
    const err = (await client.assets.get(asset.id).catch((e: unknown) => e)) as NotFoundError;
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.errorCode).toBe("ASSET_NOT_FOUND");
  });

  it("rejects an unsupported MIME type and an invalid content part (Krun One V1)", async () => {
    const mime = (await client.assets
      .create(new Uint8Array([1, 2]), { mimeType: "video/mp4" })
      .catch((e: unknown) => e)) as InvalidRequestError;
    expect(mime).toBeInstanceOf(InvalidRequestError);
    expect(mime.statusCode).toBe(415);
    expect(mime.errorCode).toBe("UNSUPPORTED_MIME_TYPE");
    // Not a valid asset id pattern: rejected by the OpenAPI schema.
    await expect(
      client.decide({ context: [{ type: "image", assetId: "nope" }], questions: { p: QUESTIONS.priority } }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
  });
});
