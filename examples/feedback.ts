// Report whether an answer was right, so Krun can measure quality on real traffic.
import { Krun, NotFoundError } from "@krun-ai/sdk";

const client = new Krun();

const result = await client.decide({
  context: "I was charged twice for the same order.",
  questions: {
    department: { type: "choice", options: { shipping: "", returns: "", billing: "" } },
  },
});
console.log("decided:", result.answers.department.choice, "| request id:", result.requestId);

// Later, once a human (or a downstream system) knows the right answer:
try {
  const fb = await client.feedback({
    requestId: result.requestId,
    questionId: "department", // always required, also for single-question requests
    correct: result.answers.department.choice === "billing",
    expectedDecision: "billing",
    metadata: { source: "examples/feedback.ts" }, // optional; no personal data
  });
  console.log("feedback stored:", fb.id, fb.createdAt.toISOString());
} catch (err) {
  if (err instanceof NotFoundError) console.log("unknown request id for this project");
  else throw err;
}
