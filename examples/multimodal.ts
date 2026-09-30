// Krun One V1: decide on a document plus text, with a `multi` question.
//
//   npx tsx examples/multimodal.ts invoice.pdf
import { readFile } from "node:fs/promises";
import { Krun } from "@krun-ai/sdk";

const client = new Krun();
const path = process.argv[2] ?? "invoice.pdf";

// Upload the file (raw bytes + MIME type). Assets expire after 24 h and are usable only by this project.
const asset = await client.assets.create(await readFile(path), { mimeType: "application/pdf" });
console.log(`uploaded ${asset.id} (${asset.sizeBytes} bytes, expires ${asset.expiresAt.toISOString()})`);

try {
  const result = await client.decide({
    context: [
      { type: "text", text: "Is this invoice paid?" },
      { type: "document", assetId: asset.id },
    ],
    questions: {
      paid: { type: "noul", instructions: "Is the document marked as paid?" },
      tags: { type: "multi", options: { invoice: null, receipt: null, overdue: "Past its due date" } },
    },
  });
  console.log(`paid: ${(result.answers.paid.noul * 100).toFixed(1)}%`);
  console.log("tags:", result.answers.tags.values, result.answers.tags.probabilities);
} finally {
  // Optional: assets expire on their own, but can be deleted as soon as they are no longer needed.
  await client.assets.delete(asset.id);
}
