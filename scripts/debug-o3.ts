import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });
import OpenAI from "openai";

async function main() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://api.openai.stream/v1", // Using standard OpenAI for o3-mini since HF might not support it natively? Wait, whatever the original script used.
  });

  // Let's just use the exact initialization from the app
  const key = process.env.OPENAI_API_KEY!;
  const base = process.env.OPENAI_BASE_URL || undefined;
  
  const client = new OpenAI({ apiKey: key, baseURL: base });

  const res = await client.chat.completions.create({
    model: "o3-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: `Today: 2026-04-01. Context: none. For each ticker in [AAPL, MSFT], return a JSON object:\n{"results": [{"ticker":"SYMBOL","action":"Buy","confidence":"high","keyReason":"one sentence citing a specific fact","evidenceQuality":"high"}]}\n\nValid action values: Buy, Hold, Sell, Trim\nValid confidence values: high, medium, low\nDo NOT use any other values.`
      }
    ]
  });

  console.log("Raw Response:", res.choices[0]?.message?.content);
}

main().catch(console.error);
