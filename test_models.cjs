const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-flash-lite-latest",
      contents: "hello"
    });
    console.log("flash-lite-latest works", response.text);
  } catch(e) {
    console.log("flash-lite-latest fails", e.message);
  }
}
run();
