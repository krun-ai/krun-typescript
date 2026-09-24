// SDK overhead vs raw fetch against a local mock server (no network, no cost).
//
//   npm run bench            (builds first)
//
// Both sides send the same 3-question request over keep-alive to the same local server; the difference is what the
// SDK adds (serialization, camelCase mapping, response validation, error/retry plumbing).

import { createServer } from "node:http";
import { Krun } from "../dist/index.js";

const KEY = "krun_test_mockkey";
const N = Number(process.argv[2] ?? 2000);
const QUESTIONS = {
  department: { type: "choice", options: { shipping: "Shipping", returns: "Returns", billing: "Billing" } },
  priority: { type: "choice", options: { low: "", normal: "", high: "" } },
  tool: { type: "choice", taskType: "tool", options: { a: "Tool A", b: "Tool B", c: "Tool C" } },
};
const WIRE = {
  context: "Customer wants to return an item.",
  questions: { ...QUESTIONS, tool: { type: "choice", task_type: "tool", options: QUESTIONS.tool.options } },
};
const answer = {
  type: "choice",
  choice: "a",
  confidence: 0.5,
  probabilities: { a: 0.7, b: 0.2, c: 0.1 },
  abstain: false,
  abstention_status: "advisory",
};
const RESPONSE = JSON.stringify({
  model: "krun-one-v0",
  answers: { department: answer, priority: answer, tool: answer },
  usage: { input_tokens: 99 },
});

const server = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json", "X-Request-ID": "req_bench" });
    res.end(RESPONSE);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;

const raw = async () => {
  const res = await fetch(`${url}/v1/decide`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(WIRE),
  });
  await res.json();
};
const client = new Krun({ apiKey: KEY, baseUrl: url });
const sdk = () => client.decide({ context: "Customer wants to return an item.", questions: QUESTIONS });

async function timed(fn, n) {
  for (let i = 0; i < 100; i++) await fn();
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await fn();
    out.push((performance.now() - t) * 1000);
  }
  return out;
}
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length * p) / 100)];

const rawT = [];
const sdkT = [];
for (let r = 0; r < 4; r++) {
  rawT.push(...(await timed(raw, N / 4)));
  sdkT.push(...(await timed(sdk, N / 4)));
}
server.close();
console.log(`n=${N} (local mock server, keep-alive, 3 questions, node ${process.version})`);
console.log(
  `raw fetch    p50 ${pct(rawT, 50).toFixed(1).padStart(8)} us  p99 ${pct(rawT, 99).toFixed(1).padStart(8)} us`,
);
console.log(
  `krun SDK     p50 ${pct(sdkT, 50).toFixed(1).padStart(8)} us  p99 ${pct(sdkT, 99).toFixed(1).padStart(8)} us`,
);
console.log(`SDK overhead p50 ${(pct(sdkT, 50) - pct(rawT, 50)).toFixed(1).padStart(8)} us`);
