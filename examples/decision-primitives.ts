// Choice, noul and score questions about the same context, answered in a single API call.
import { Krun } from "@krun-ai/sdk";

const client = new Krun();

const result = await client.decide({
  context: "Customer says this is the third time exports failed and wants a human immediately.",
  questions: {
    // choice: pick one option
    department: { type: "choice", options: { billing: "", support: "", sales: "" } },
    // noul: probability that a yes/no proposition holds
    needs_human: {
      type: "noul",
      instructions: "Is the customer asking to speak with a human?",
      criteria: { true: "Explicitly requests a person or human agent" },
    },
    // score: ordered levels, lowest first (order is meaning: never shuffle it)
    severity: {
      type: "score",
      instructions: "How severe is the reported issue?",
      levels: ["Minor issue", "Feature degraded", "Blocking issue"],
    },
  },
});

// Each answer is typed by its question: no casts needed.
console.log("department:", result.answers.department.choice);
console.log(`needs_human: ${(result.answers.needs_human.noul * 100).toFixed(1)}%`);
const severity = result.answers.severity;
console.log(`severity: ${severity.score.toFixed(2)} / ${Object.keys(severity.legend).length - 1}`);
for (const [index, level] of Object.entries(severity.legend)) {
  console.log(`  ${level.padEnd(18)} ${((severity.probabilities[index] ?? 0) * 100).toFixed(0)}%`);
}

// With answers of unknown type, narrow on `type`:
for (const answer of Object.values(result.answers)) {
  if (answer.type === "score") console.log("score confidence:", answer.confidence);
}
