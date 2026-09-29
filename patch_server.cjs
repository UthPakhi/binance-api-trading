const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const signalsEndpoint = `
// --- AI Background Signals Engine ---
let cachedSignals: any = null;
let lastSignalTime: number = 0;

app.get("/api/ai-signals", async (req, res) => {
  try {
    const now = Date.now();
    // Cache for 15 minutes to simulate background analysis and save API calls
    if (cachedSignals && (now - lastSignalTime < 15 * 60 * 1000)) {
      return res.json({ status: "success", signals: cachedSignals, generatedAt: lastSignalTime });
    }

    // Generate new signals
    console.log("Generating fresh background AI signals...");
    const btcContext = await getBtcVolatilityGuard();
    const ethContext = await analyzePriceAction('ETHUSDT');
    const solContext = await analyzePriceAction('SOLUSDT');
    
    const prompt = \`
You are an institutional quantitative trading AI. Analyze the current market context and generate 3 high-probability trade setups (1 Scalp, 1 Day Trade, 1 Swing Trade).
Use these context metrics:
BTC: \${JSON.stringify(btcContext)}
ETH: \${JSON.stringify(ethContext)}
SOL: \${JSON.stringify(solContext)}

Identify 3 distinct trading opportunities (you can choose BTC, ETH, SOL or any major high-liquidity altcoin).
Calculate realistic Risk/Reward. Be highly precise with prices.
\`

    const response = await generateWithFallback({
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            signals: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  symbol: { type: Type.STRING },
                  type: { type: Type.STRING, description: "Scalp, Day, or Swing" },
                  confidence: { type: Type.INTEGER, description: "Confidence score 1-100" },
                  isLong: { type: Type.BOOLEAN },
                  entry: { type: Type.NUMBER },
                  sl: { type: Type.NUMBER },
                  tp1: { type: Type.NUMBER },
                  tp1Pct: { type: Type.INTEGER },
                  tp2: { type: Type.NUMBER },
                  tp2Pct: { type: Type.INTEGER },
                  tp3: { type: Type.NUMBER },
                  tp3Pct: { type: Type.INTEGER },
                  notes: { type: Type.STRING },
                  validForHours: { type: Type.NUMBER, description: "How many hours this setup remains valid before invalidating" }
                },
                required: ["id", "symbol", "type", "confidence", "isLong", "entry", "sl", "tp1", "tp1Pct", "tp2", "tp2Pct", "tp3", "tp3Pct", "notes", "validForHours"]
              }
            }
          },
          required: ["signals"]
        }
      }
    });

    const data = JSON.parse(response.text());
    cachedSignals = data.signals;
    lastSignalTime = now;

    res.json({ status: "success", signals: cachedSignals, generatedAt: lastSignalTime });
  } catch (error: any) {
    console.error("AI Signals Error:", error);
    if (cachedSignals) {
       res.json({ status: "success", signals: cachedSignals, generatedAt: lastSignalTime, isStale: true });
    } else {
       res.status(500).json({ status: "error", error: error.message });
    }
  }
});
`;

code = code.replace('  // API routes FIRST', '  // API routes FIRST' + signalsEndpoint);

fs.writeFileSync('server.ts', code);
console.log("Patched server.ts with /api/ai-signals");
