/** Compile-time checks of the public types (`tsc --noEmit` fails if they regress); the runtime part is trivial. */

import { describe, expectTypeOf, it } from "vitest";
import type {
  Answer,
  ChoiceAnswer,
  DecisionResult,
  Krun,
  NoulAnswer,
  Questions,
  ScoreAnswer,
  Usage,
} from "../src/index.js";

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
    expectTypeOf<Result["answers"][string]>().toEqualTypeOf<Answer>();
  });

  it("types each answer by its question's primitive", () => {
    const pending = () =>
      client.decide({
        context: "x",
        questions: {
          department: { type: "choice", options: { billing: "", support: null } },
          needs_human: { type: "noul", instructions: "Is the customer asking for a human?" },
          severity: { type: "score", instructions: "How severe?", levels: ["Minor", "Moderate", "Critical"] },
        },
      });
    type Result = Awaited<ReturnType<typeof pending>>;
    expectTypeOf<Result["answers"]["department"]>().toEqualTypeOf<ChoiceAnswer<"billing" | "support">>();
    expectTypeOf<Result["answers"]["needs_human"]>().toEqualTypeOf<NoulAnswer>();
    expectTypeOf<Result["answers"]["severity"]>().toEqualTypeOf<ScoreAnswer>();
    expectTypeOf<Result["answers"]["severity"]["score"]>().toEqualTypeOf<number>();
  });

  it("narrows a generic answer on its type", () => {
    const describe = (answer: Answer): number | string | null => {
      if (answer.type === "score") return answer.score;
      if (answer.type === "noul") return answer.noul;
      return answer.choice;
    };
    expectTypeOf(describe).returns.toEqualTypeOf<number | string | null>();
  });

  it("exposes only input tokens", () => {
    expectTypeOf<keyof Usage>().toEqualTypeOf<"inputTokens">();
  });

  it("rejects unknown question types and bad options at compile time", () => {
    const reject = () => {
      // @ts-expect-error: unknown question type
      void client.decide({ context: "x", questions: { q: { type: "rank", options: { a: "" } } } });
      // @ts-expect-error: score questions take levels, not options
      void client.decide({ context: "x", questions: { q: { type: "score", instructions: "?", options: { a: "" } } } });
      // @ts-expect-error: noul questions need instructions
      void client.decide({ context: "x", questions: { q: { type: "noul" } } });
      // @ts-expect-error: option descriptions are strings or null
      void client.decide({ context: "x", questions: { q: { type: "choice", options: { a: 1 } } } });
    };
    void reject;
  });
});
