// Several questions about the same context, answered in a single API call.
import { Krun } from "@krun-ai/sdk";

const client = new Krun();

const result = await client.decide({
  context: "My card was charged twice for the same order and I need the money back today, this is ridiculous.",
  questions: {
    department: {
      type: "choice",
      options: {
        shipping: "Shipping and delivery issues",
        returns: "Returns and refunds",
        billing: "Billing and payment issues",
      },
    },
    priority: {
      type: "choice",
      options: { low: "Can wait", normal: "Normal priority", high: "Needs quick attention" },
    },
    sentiment: {
      // Label-only options: "" (or null) as the description.
      type: "choice",
      options: { positive: "", neutral: "", negative: "" },
    },
  },
});

// Same ids, same order as the request.
for (const [questionId, answer] of Object.entries(result.answers)) {
  if (answer.choice === null) {
    const [bestGuess] = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1])[0] ?? [];
    console.log(`${questionId.padEnd(10)} abstained (best guess ${bestGuess}, margin ${answer.confidence.toFixed(3)})`);
  } else {
    console.log(
      `${questionId.padEnd(10)} ${answer.choice} (margin ${answer.confidence.toFixed(3)}, ${answer.abstentionStatus})`,
    );
  }
}

console.log("priority:", result.answers.priority.choice); // "low" | "normal" | "high" | null
console.log("input tokens:", result.usage.inputTokens, "| request id:", result.requestId);
