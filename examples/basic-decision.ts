// One question, one answer.
// Run: npm run build && KRUN_API_KEY=krun_live_... npx tsx examples/basic-decision.ts
import { Krun } from "@krun-ai/sdk";

const client = new Krun(); // reads process.env.KRUN_API_KEY

const result = await client.decide({
  context: "Customer wants to return an item.",
  questions: {
    department: {
      type: "choice",
      options: {
        shipping: "Shipping and delivery issues",
        returns: "Returns and refunds",
        billing: "Billing and payment issues",
      },
    },
  },
});

const answer = result.answers.department; // typed: "department" autocompletes
console.log("choice:       ", answer.choice); // "shipping" | "returns" | "billing" | null (null = abstained)
console.log("confidence:   ", answer.confidence); // top-1 minus top-2 probability, not P(correct)
console.log("probabilities:", answer.probabilities);
console.log("abstain:      ", answer.abstain, `(${answer.abstentionStatus})`);
console.log("input tokens: ", result.usage.inputTokens);
console.log("request id:   ", result.requestId);
