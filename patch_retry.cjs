const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const generateBlock = `async function generateWithFallback(params: any) {
  return await ai.models.generateContent({
    model: "gemini-2.5-flash",
    ...params
  });
}`;

const retryBlock = `async function generateWithFallback(params: any, retries = 2) {
  try {
    return await ai.models.generateContent({
      model: "gemini-2.5-flash",
      ...params
    });
  } catch (error: any) {
    if (retries > 0 && error.status === 429) {
      console.log("Rate limited. Retrying in 2s...");
      await new Promise(r => setTimeout(r, 2000));
      return await generateWithFallback(params, retries - 1);
    }
    throw error;
  }
}`;

code = code.replace(generateBlock, retryBlock);

fs.writeFileSync('server.ts', code);
console.log("Patched server.ts with retry logic");
