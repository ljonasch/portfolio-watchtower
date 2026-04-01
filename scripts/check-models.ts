import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function main() {
  // 1. List all available models
  const list = await openai.models.list();
  const relevant = list.data
    .map(m => m.id)
    .filter(id => id.match(/gpt-5|o3|o1|gpt-4o/i))
    .sort();

  console.log("\n=== Available Models (filtered) ===");
  relevant.forEach(m => console.log(" -", m));

  const hasGPT5 = relevant.some(m => m.includes("gpt-5"));
  const hasO3   = relevant.some(m => m.includes("o3"));

  console.log("\n=== Access Summary ===");
  console.log("gpt-5:    ", hasGPT5 ? "✅ YES" : "❌ NO");
  console.log("o3/o3-mini:", hasO3  ? "✅ YES" : "❌ NO");

  // 2. Quick test call to the best available model
  const testModel = hasGPT5 ? "gpt-5" : hasO3 ? "o3-mini" : "gpt-4o";
  console.log(`\n=== Test call → ${testModel} ===`);
  try {
    const res = await openai.chat.completions.create({
      model: testModel,
      max_tokens: 10,
      messages: [{ role: "user", content: "Reply with just: OK" }],
    });
    console.log("Response:", res.choices[0]?.message?.content?.trim());
    console.log("Model used:", res.model);
  } catch (e: any) {
    console.log("Error:", e?.message);
  }
}

main().catch(console.error);
