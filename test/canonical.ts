import { createHash } from "node:crypto";

/** Canonical JSON (sorted keys, no whitespace), byte-identical to Python's json.dumps(sort_keys=True, separators). */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((k) => `${pyJsonString(k)}:${canonical((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return typeof value === "string" ? pyJsonString(value) : JSON.stringify(value);
}

// Python's json.dumps escapes every non-ASCII character (ensure_ascii=True); match it so hashes agree across SDKs.
function pyJsonString(s: string): string {
  return JSON.stringify(s).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
