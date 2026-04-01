require('dotenv').config();
const key = process.env.HUGGINGFACE_API_KEY;
const base = 'https://router.huggingface.co/hf-inference/models';
const text = 'NVDA beat Q4 earnings estimates, raising full-year guidance.';

async function test(name, model) {
  const start = Date.now();
  try {
    const r = await fetch(`${base}/${model}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: text }),
      signal: AbortSignal.timeout(90000)
    });
    const d = await r.json();
    const labels = Array.isArray(d?.[0]) ? d[0].slice(0,3) : d;
    console.log(`${name} (${Date.now()-start}ms): ${JSON.stringify(labels)}`);
  } catch(e) {
    console.log(`${name} FAILED (${Date.now()-start}ms): ${e.message}`);
  }
}

test('FinBERT', 'ProsusAI/finbert')
  .then(() => test('DistilRoBERTa', 'mrm8488/distilroberta-finetuned-financial-news-sentiment-analysis'))
  .then(() => console.log('DONE'));
