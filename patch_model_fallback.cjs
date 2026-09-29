const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const target = `async function generateWithFallback(params: any, retries = 2, useFallbackModel = false) {
  try {
    return await ai.models.generateContent({
      model: useFallbackModel ? "gemini-1.5-flash" : "gemini-2.5-flash",
      ...params
    });
  } catch (error: any) {
    if (error.status === 429) {
      if (!useFallbackModel) {
        console.log("2.5-flash rate limited. Falling back to gemini-1.5-flash...");
        return await generateWithFallback(params, 2, true);
      } else if (retries > 0) {
        console.log("1.5-flash rate limited. Retrying in 2s...");
        await new Promise(r => setTimeout(r, 2000));
        return await generateWithFallback(params, retries - 1, true);
      }
    }
    throw error;
  }
}`;

const replace = `async function generateWithFallback(params: any, retries = 2, useFallbackModel = false) {
  try {
    return await ai.models.generateContent({
      model: useFallbackModel ? "gemini-flash-lite-latest" : "gemini-2.5-flash",
      ...params
    });
  } catch (error: any) {
    if (error.status === 429) {
      if (!useFallbackModel) {
        console.log("2.5-flash rate limited. Falling back to gemini-flash-lite-latest...");
        return await generateWithFallback(params, 2, true);
      } else if (retries > 0) {
        console.log("flash-lite-latest rate limited. Retrying in 2s...");
        await new Promise(r => setTimeout(r, 2000));
        return await generateWithFallback(params, retries - 1, true);
      }
    }
    throw error;
  }
}`;

if(code.includes('useFallbackModel ? "gemini-1.5-flash" : "gemini-2.5-flash"')) {
  code = code.replace(target, replace);
  fs.writeFileSync('server.ts', code);
  console.log("Patched model fallback");
} else {
  console.log("Target not found");
}
