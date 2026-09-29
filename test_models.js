const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: "hello"
    });
    console.log("2.0-flash works", response.text);
  } catch (e) {
    console.log("2.0-flash fails", e.message);
  }
}
run();
