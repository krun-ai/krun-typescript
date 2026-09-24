// Manual production smoke test of the built package: one real decision (2 questions), one feedback row, models and
// error mapping.
//
//   KRUN_API_KEY=krun_live_... npm run smoke            (builds first)
//   KRUN_API_KEY=krun_live_... node scripts/smoke.mjs --base-url https://api.krun.ai
//
// Cost: one GPU job. The feedback row is tagged { source: "krun-typescript-smoke" }. The key is never printed.

import { AuthenticationError, DEFAULT_BASE_URL, InvalidRequestError, Krun, VERSION } from "../dist/index.js";

const i = process.argv.indexOf("--base-url");
const baseUrl = i >= 0 ? process.argv[i + 1] : DEFAULT_BASE_URL;
const client = new Krun({ baseUrl });
console.log(`krun-typescript ${VERSION} -> ${client.baseUrl}`);

console.log(
  "models:",
  (await client.models()).map((m) => [m.id, m.status]),
);

try {
  await client.decide({ context: "x", questions: { q: { type: "choice", options: { only: "" } } } });
} catch (e) {
  if (!(e instanceof InvalidRequestError)) throw e;
  console.log(`invalid request mapped: ${e.name} code=${e.errorCode} status=${e.statusCode} requestId=${e.requestId}`);
}

try {
  await new Krun({ apiKey: "krun_live_invalidinvalidinvalidinvalid00", baseUrl }).models();
} catch (e) {
  if (!(e instanceof AuthenticationError)) throw e;
  console.log(`bad key mapped: ${e.name} code=${e.errorCode} requestId=${e.requestId}`);
}

const t0 = performance.now();
const result = await client.decide({
  context: "I was charged twice for my order, can you refund the duplicate payment?",
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
console.log(
  `decide: ${((performance.now() - t0) / 1000).toFixed(2)}s model=${result.model} requestId=${result.requestId} ` +
    `inputTokens=${result.usage.inputTokens}`,
);
for (const [id, a] of Object.entries(result.answers)) {
  console.log(
    `  ${id}: choice=${JSON.stringify(a.choice)} confidence=${a.confidence.toFixed(4)} abstain=${a.abstain} ` +
      `status=${a.abstentionStatus} probabilities=${JSON.stringify(a.probabilities)}`,
  );
}

const fb = await client.feedback({
  requestId: result.requestId,
  questionId: "department",
  correct: result.answers.department.choice === "billing",
  expectedDecision: "billing",
  metadata: { source: "krun-typescript-smoke" },
});
console.log(`feedback: id=${fb.id} questionId=${fb.questionId} createdAt=${fb.createdAt.toISOString()}`);
