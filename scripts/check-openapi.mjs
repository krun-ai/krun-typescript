// Compare the live OpenAPI document with the snapshot this SDK was written against.
//
//   node scripts/check-openapi.mjs            exit 0: identical, 1: drift (prints what changed), 2: fetch failed
//   node scripts/check-openapi.mjs --update   overwrite openapi/openapi.json and print the new hash/version
//
// After --update: `npm run generate:openapi`, set OPENAPI_SHA256 / OPENAPI_VERSION in src/constants.ts, then run
// `npm run typecheck && npm test`; tsc and test/contract.test.ts point at every model that has to follow the change.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const SNAPSHOT = new URL("../openapi/openapi.json", import.meta.url);
const args = process.argv.slice(2);
const urlArg = args.indexOf("--url");
const url = urlArg >= 0 ? args[urlArg + 1] : "https://api.krun.ai/openapi.json";

// Canonical JSON identical to Python's json.dumps(sort_keys=True, separators=(",", ":")), so both SDKs pin one hash.
const pyString = (s) =>
  JSON.stringify(s).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${pyString(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return typeof v === "string" ? pyString(v) : JSON.stringify(v);
}
const sha = (v) => createHash("sha256").update(canonical(v)).digest("hex");

function diff(a, b, path = "$") {
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const out = [];
    for (const k of Object.keys(b)) if (!(k in a)) out.push(`+ ${path}.${k}`);
    for (const k of Object.keys(a)) if (!(k in b)) out.push(`- ${path}.${k}`);
    for (const k of Object.keys(a)) if (k in b) out.push(...diff(a[k], b[k], `${path}.${k}`));
    return out.sort();
  }
  return canonical(a) === canonical(b)
    ? []
    : [`~ ${path}: ${JSON.stringify(a)?.slice(0, 80)} -> ${JSON.stringify(b)?.slice(0, 80)}`];
}

let live;
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  live = await res.json();
} catch (err) {
  console.error(`could not fetch ${url}: ${err}`);
  process.exit(2);
}
const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
if (args.includes("--update")) {
  writeFileSync(SNAPSHOT, `${JSON.stringify(live, null, 2)}\n`);
  console.log(`snapshot updated: version=${live.info.version} sha256=${sha(live)}`);
  process.exit(0);
}
if (sha(live) === sha(snapshot)) {
  console.log(`OK: live OpenAPI ${live.info.version} matches the snapshot (${sha(live).slice(0, 12)})`);
  process.exit(0);
}
console.log(`DRIFT: live OpenAPI (${live.info.version}) differs from openapi/openapi.json:`);
for (const line of diff(snapshot, live)) console.log(`  ${line}`);
process.exit(1);
