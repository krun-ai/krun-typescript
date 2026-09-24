// Tool / function routing: `taskType: "tool"`.
//
// Abstention for tool routing is `advisory`: `abstain` is a hint, not a validated guarantee. Keep your own guard
// (e.g. a "none of these" path) for requests that match no tool.
import { Krun } from "@krun-ai/sdk";

const client = new Krun();

const result = await client.decide({
  context: "Find my meetings tomorrow.",
  questions: {
    tool: {
      type: "choice",
      taskType: "tool",
      options: {
        calendar_search: "Search calendar events by date, person or title",
        send_email: "Send an email to a contact",
        weather_lookup: "Get the weather forecast for a city",
      },
    },
  },
});

const answer = result.answers.tool;
console.log("abstentionStatus:", answer.abstentionStatus); // "advisory" for tool routing
switch (answer.choice) {
  case "calendar_search":
  case "send_email":
  case "weather_lookup":
    console.log(`call ${answer.choice} (margin ${answer.confidence.toFixed(3)})`);
    break;
  case null:
    console.log("no tool selected; probabilities:", answer.probabilities);
}
