/**
 * A local HTTP server that speaks the Krun API contract (for contract/integration tests).
 *
 * - Validates every request body against the committed OpenAPI snapshot (`openapi/openapi.json`) and answers
 *   `400 INVALID_REQUEST` like the real API when it does not match.
 * - Checks `Authorization: Bearer <key>`, echoes/generates `X-Request-ID`.
 * - Answers `/v1/decide` with one well-formed answer per question (first option wins; a context containing
 *   "unsure" makes every answer abstain), `/v1/feedback` and `/v1/models` like production.
 * - `enqueue()` scripts the next responses (status, body, headers, delay) to simulate errors and slowness.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

export const OPENAPI = JSON.parse(readFileSync(new URL("../openapi/openapi.json", import.meta.url), "utf8"));

export function schemaValidator(name: string): ValidateFunction {
  // OpenAPI 3.1 schemas are JSON Schema 2020-12; the root carries `components` for `$ref` resolution.
  const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: false });
  return ajv.compile({ ...OPENAPI, $ref: `#/components/schemas/${name}` });
}

const VALIDATORS = { decide: schemaValidator("DecideRequest"), feedback: schemaValidator("FeedbackRequest") };

export interface Scripted {
  status: number;
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
  delayMs?: number;
}

export interface Recorded {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: unknown;
}

type WireQuestion = { type: string; options: Record<string, string | null>; task_type?: string | null };

export class MockKrunAPI {
  readonly requests: Recorded[] = [];
  private readonly script: Scripted[] = [];
  private readonly server: Server;
  url = "";

  constructor(readonly apiKey = "krun_test_mockkey") {
    this.server = createServer((req, res) => void this.handle(req, res));
    this.server.keepAliveTimeout = 1000;
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  enqueue(...responses: Scripted[]): void {
    this.script.push(...responses);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      // keep raw text
    }
    this.requests.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers, body });
    const incoming = req.headers["x-request-id"];
    const rid = typeof incoming === "string" && incoming ? incoming : `req_${randomUUID().replaceAll("-", "")}`;
    const scripted = this.script.shift();
    if (scripted) {
      if (scripted.delayMs) await new Promise((r) => setTimeout(r, scripted.delayMs));
      if (res.destroyed) return;
      const payload = scripted.raw ?? JSON.stringify(scripted.body ?? {});
      res.writeHead(scripted.status, { "Content-Type": "application/json", "X-Request-ID": rid, ...scripted.headers });
      res.end(payload);
      return;
    }
    const [status, out] = this.route(req.method ?? "", req.url ?? "", req.headers.authorization, body, rid);
    res.writeHead(status, { "Content-Type": "application/json", "X-Request-ID": rid });
    res.end(JSON.stringify(out));
  }

  private error(status: number, code: string, message: string, rid: string): [number, unknown] {
    return [status, { error: { code, message, request_id: rid } }];
  }

  private route(method: string, path: string, auth: string | undefined, body: unknown, rid: string): [number, unknown] {
    if (auth !== `Bearer ${this.apiKey}`)
      return this.error(401, "UNAUTHORIZED", "missing, invalid or revoked API key", rid);
    if (method === "GET" && path === "/v1/models") {
      return [200, { object: "list", data: [{ id: "krun-one-v0", object: "model", status: "available" }] }];
    }
    if (method === "POST" && path === "/v1/feedback") {
      if (!VALIDATORS.feedback(body)) {
        return this.error(400, "INVALID_REQUEST", VALIDATORS.feedback.errors?.[0]?.message ?? "invalid", rid);
      }
      const b = body as { request_id: string; question_id: string };
      return [
        201,
        {
          id: `fb_${randomUUID().replaceAll("-", "")}`,
          object: "feedback",
          request_id: b.request_id,
          question_id: b.question_id,
          created_at: "2026-09-24T12:34:56.123456789Z",
        },
      ];
    }
    if (method === "POST" && path === "/v1/decide") {
      if (!VALIDATORS.decide(body)) {
        return this.error(400, "INVALID_REQUEST", VALIDATORS.decide.errors?.[0]?.message ?? "invalid", rid);
      }
      const b = body as { context: string; model?: string | null; questions: Record<string, WireQuestion> };
      const answers: Record<string, unknown> = {};
      let tokens = 0;
      for (const [qid, q] of Object.entries(b.questions)) {
        const options = Object.keys(q.options);
        if (options.length < 2 || options.length > 64) {
          const msg = `questions.${qid}: ${options.length} options given; between 2 and 64 are required`;
          return this.error(400, "INVALID_OPTIONS", msg, rid);
        }
        const unsure = b.context.includes("unsure");
        const rest = unsure ? 0.3 : 0.1;
        const probabilities: Record<string, number> = {};
        for (const o of options) probabilities[o] = rest / (options.length - 1);
        const top = options[0] as string;
        probabilities[top] = 1 - rest;
        const second = Math.max(...options.slice(1).map((o) => probabilities[o] as number));
        const labelOnly = Object.values(q.options).every((d) => !d);
        const calibrated = (q.task_type ?? "intent") === "intent" && labelOnly;
        answers[qid] = {
          type: "choice",
          choice: unsure ? null : top,
          confidence: 1 - rest - second,
          probabilities,
          abstain: unsure,
          abstention_status: calibrated ? "calibrated" : "advisory",
        };
        tokens += 10 + b.context.split(/\s+/).length + 3 * options.length;
      }
      return [200, { model: b.model ?? "krun-one-v0", answers, usage: { input_tokens: tokens } }];
    }
    return this.error(404, "NOT_FOUND", "no route", rid);
  }
}
