const raw = `
<think>
Let's analyze this portfolio...
I need to output JSON now.
</think>

Here is the requested output:
\`\`\`json
{
  "results": [
    {"ticker": "NVDA", "action": "Buy", "confidence": "high", "keyReason": "High growth.", "evidenceQuality": "high"}
  ]
}
\`\`\`
`;

let parsed: any[] | null = null;
let jsonString = raw;

const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
if (jsonMatch) {
  jsonString = jsonMatch[1];
} else {
  // If no markdown block is found, strip <think> tag blocks explicitly
  jsonString = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

console.log("Stripped JSON String:\n", jsonString);

// Layer 1: Try slicing the first { to the last } or [ to ]
let start = jsonString.indexOf("{");
let end = jsonString.lastIndexOf("}");

const arrStart = jsonString.indexOf("[");
const arrEnd = jsonString.lastIndexOf("]");

// If array structure encloses the object structure, prefer array bounds
if (arrStart !== -1 && arrEnd !== -1 && (start === -1 || arrStart < start)) {
  start = arrStart;
  end = arrEnd;
}

if (start !== -1 && end !== -1 && end >= start) {
  const potential = JSON.parse(jsonString.slice(start, end + 1));
  console.log("Parsed Potential:", potential);
  if (potential.results && Array.isArray(potential.results)) {
    parsed = potential.results;
  }
}

console.log("Final Parsed:", parsed);
