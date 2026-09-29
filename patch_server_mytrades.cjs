const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const route = `  app.get("/api/binance/myTrades", async (req, res) => {
    try {
      const { symbol, startTime } = req.query;
      const apiKey = process.env.BINANCE_API_KEY;
      const apiSecret = process.env.BINANCE_API_SECRET;
      
      if (!apiKey || !apiSecret) {
        return res.status(400).json({ status: "error", message: "Binance API keys are missing in the environment." });
      }

      const timestamp = Date.now();
      let queryString = \`symbol=\${symbol}&timestamp=\${timestamp}\`;
      if (startTime) {
         queryString += \`&startTime=\${startTime}\`;
      }
      const signature = require('crypto').createHmac('sha256', apiSecret).update(queryString).digest('hex');
      
      const tradesRes = await fetch(\`https://api.binance.com/api/v3/myTrades?\${queryString}&signature=\${signature}\`, {
        headers: { 'X-MBX-APIKEY': apiKey }
      });
      
      if (!tradesRes.ok) {
        throw new Error("Failed to fetch myTrades from Binance.");
      }
      
      const data = await tradesRes.json();
      res.json({ status: "success", trades: data });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });`;

if (!code.includes('/api/binance/myTrades')) {
   code = code.replace('app.post("/api/suggest-trade"', route + '\\n\\n  app.post("/api/suggest-trade"');
   fs.writeFileSync('server.ts', code);
}
