import { parsePortfolioScreenshot } from "./src/lib/parser";

async function main() {
  try {
    // Just passing an empty object but it will crash earlier if API is bad, actually we need to pass a valid-looking object.
    const fakeFile = {
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      type: "image/png"
    } as any as File;
    await parsePortfolioScreenshot(fakeFile);
  } catch (error) {
    console.error(error);
  }
}
main();
