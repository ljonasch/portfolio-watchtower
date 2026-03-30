import OpenAI from "openai";

export interface ParsedHolding {
  ticker: string;
  companyName?: string;
  shares: number;
  currentPrice?: number;
  currentValue?: number;
  isCash?: boolean;
}

export interface ParsedScreenshotData {
  holdings: ParsedHolding[];
  warnings?: string[];
}

export async function parsePortfolioScreenshot(file: File): Promise<ParsedScreenshotData> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in your .env file. Please add an OpenAI API key to parse images via GPT-5.4.");
  }
  
  const openai = new OpenAI({ apiKey });
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString('base64');
  const mimeType = file.type || 'image/jpeg';
  
  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { 
            type: "text", 
            text: `Extract portfolio holdings from this image of a brokerage account. Return a JSON object with two keys: "holdings" (an array) and an optional "warnings" array of strings.

CRITICAL RULES FOR HOLDINGS:
Every object in the "holdings" array must have exactly these fields:
- ticker (string, uppercase or 'CASH')
- companyName (string, if decipherable, else omit)
- shares (number, clean of commas; if missing or N/A, use 0)
- currentPrice (number, clean of $ and commas; if missing from the image completely, use 0)
- currentValue (number, clean of $ and commas; if missing from the image completely, use 0)
- isCash (boolean)

If a row is cash or a money market sweep, set ticker to "CASH", isCash to true, shares to the dollar amount, and currentPrice to 1.

CRITICAL PARSING INSTRUCTIONS:
1. NEVER confuse a percentage (%) with a price. If a column has percent signs or sums vertically to roughly 100, it is a portfolio WEIGHT (% of total), NOT a stock price. Ignore portfolio weight entirely!
2. You must mathematically self-check your extraction: (shares * currentPrice) MUST roughly equal currentValue. If currentPrice or currentValue are 0, skip the math check. If the math fails drastically, you have misidentified the columns. If you are ever forced to extract data that fails this math check, or if headers are completely missing and ambiguous, you MUST push a clear explanation into the "warnings" array highlighting the specific ticker and the ambiguity so the user can be alerted.` 
          },
          { 
            type: "image_url", 
            image_url: { url: `data:${mimeType};base64,${base64}` } 
          }
        ]
      }
    ]
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Failed to extract data: OpenAI returned empty response.");
  
  try {
    const json = JSON.parse(content);
    return {
      holdings: json.holdings as ParsedHolding[],
      warnings: json.warnings as string[] | undefined
    };
  } catch(e) {
    throw new Error("Failed to parse the OpenAI JSON response properly.");
  }
}
