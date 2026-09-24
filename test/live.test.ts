/**
 * Opt-in checks against production (https://api.krun.ai). Never run by default or in CI.
 *
 *     KRUN_LIVE_TESTS=1 KRUN_API_KEY=krun_live_... npm run test:live
 *
 * Costs: the OpenAPI and models checks are free; the decide test makes one real decision (one GPU job) and stores one
 * feedback row tagged { source: "krun-typescript-smoke" }.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, InvalidRequestError, Krun } from "../src/index.js";
import { canonicalSha256 } from "./canonical.js";

const LIVE = process.env.KRUN_LIVE_TESTS === "1";
const BASE_URL = process.env.KRUN_BASE_URL ?? DEFAULT_BASE_URL;
const HAS_KEY = Boolean(process.env.KRUN_API_KEY);

describe.skipIf(!LIVE)("production", () => {
  it("serves the OpenAPI snapshot this SDK was built against", async () => {
    const live = await (await fetch(`${BASE_URL}/openapi.json`)).json();
    const snapshot = JSON.parse(readFileSync(new URL("../openapi/openapi.json", import.meta.url), "utf8"));
    expect(canonicalSha256(live), "production OpenAPI drifted: run npm run check:openapi").toBe(
      canonicalSha256(snapshot),
    );
  });

  it.skipIf(!HAS_KEY)("lists models", async () => {
    const models = await new Krun({ baseUrl: BASE_URL }).models();
    expect(models.map((m) => m.id)).toContain("krun-one-v0");
  });

  it.skipIf(!HAS_KEY)("maps a validation error (free: rejected before inference)", async () => {
    const err = (await new Krun({ baseUrl: BASE_URL })
      .decide({ context: "x", questions: { q: { type: "choice", options: { only: "" } } } })
      .catch((e: unknown) => e)) as InvalidRequestError;
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect(err.errorCode).toBe("INVALID_OPTIONS");
    expect(err.requestId).toBeTruthy();
  });

  it.skipIf(!HAS_KEY)(
    "decides and sends feedback",
    async () => {
      const client = new Krun({ baseUrl: BASE_URL });
      const result = await client.decide({
        context: "I was charged twice for my order, can you move it to express shipping?",
        questions: {
          department: {
            type: "choice",
            options: {
              shipping: "Shipping and delivery issues",
              returns: "Returns and refunds",
              billing: "Billing and payment issues",
            },
          },
          tool: {
            type: "choice",
            taskType: "tool",
            options: { refund_payment: "Refund a duplicate charge", calendar_search: "Search calendar events" },
          },
        },
      });
      expect(Object.keys(result.answers)).toEqual(["department", "tool"]);
      expect(result.requestId).toBeTruthy();
      expect(result.answers.tool.abstentionStatus).toBe("advisory");
      const fb = await client.feedback({
        requestId: result.requestId,
        questionId: "department",
        correct: true,
        metadata: { source: "krun-typescript-smoke" },
      });
      expect(fb.requestId).toBe(result.requestId);
    },
    90_000,
  );
});
