/** Compile-time checks of the public types (`tsc --noEmit` fails if they regress); the runtime part is trivial. */

import { describe, expectTypeOf, it } from "vitest";
import type { ChoiceAnswer, DecisionResult, Krun, Questions, Usage } from "../src/index.js";

declare const client: Krun;

describe("type inference", () => {
  it("infers question ids and option ids from an inline questions object", () => {
    const pending = () =>
      client.decide({
        context: "x",
        questions: {
          department: { type: "choice", options: { shipping: "", returns: "Returns", billing: null } },
          tool: { type: "choice", taskType: "tool", options: { calendar_search: "Search", send_email: "Send" } },
        },
      });
    type Result = Awaited<ReturnType<typeof pending>>;
    expectTypeOf<keyof Result["answers"]>().toEqualTypeOf<"department" | "tool">();
    expectTypeOf<Result["answers"]["department"]["choice"]>().toEqualTypeOf<
      "shipping" | "returns" | "billing" | null
    >();
    expectTypeOf<Result["answers"]["tool"]["probabilities"]>().toEqualTypeOf<
      Record<"calendar_search" | "send_email", number>
    >();
    expectTypeOf<Result["requestId"]>().toEqualTypeOf<string>();
  });

  it("falls back to string ids for questions built at runtime", () => {
    const questions: Questions = {};
    const pending = () => client.decide({ context: "x", questions });
    type Result = Awaited<ReturnType<typeof pending>>;
    expectTypeOf<Result>().toEqualTypeOf<DecisionResult<Questions>>();
    expectTypeOf<Result["answers"][string]>().toEqualTypeOf<ChoiceAnswer<string>>();
  });

  it("exposes only input tokens", () => {
    expectTypeOf<keyof Usage>().toEqualTypeOf<"inputTokens">();
  });

  it("rejects unknown question types and bad options at compile time", () => {
    const reject = () => {
      // @ts-expect-error: only "choice" exists
      void client.decide({ context: "x", questions: { q: { type: "score", options: { a: "" } } } });
      // @ts-expect-error: option descriptions are strings or null
      void client.decide({ context: "x", questions: { q: { type: "choice", options: { a: 1 } } } });
    };
    void reject;
  });
});
