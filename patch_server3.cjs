const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const positionRoute = `
  app.get("/api/binance/positions", async (req, res) => {
    try {
      const apiKey = process.env.BINANCE_API_KEY;
      const apiSecret = process.env.BINANCE_API_SECRET;
      
      if (!apiKey || !apiSecret) {
        return res.status(400).json({ status: "error", message: "Binance API keys are missing in the environment." });
      }

      const timestamp = Date.now();
      const queryString = \`timestamp=\${timestamp}\`;
      const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
      
      const futRes = await fetch(\`https://fapi.binance.com/fapi/v2/positionRisk?\${queryString}&signature=\${signature}\`, {
        headers: { 'X-MBX-APIKEY': apiKey }
      });
      
      if (!futRes.ok) {
        const errorData = await futRes.text();
        console.error("Binance Futures API error:", errorData);
        throw new Error("Failed to fetch positions from Binance.");
      }
      
      const data = await futRes.json();
      const activePositions = data.filter((p) => parseFloat(p.positionAmt) !== 0);
      
      const positions = activePositions.map((p) => ({
        symbol: p.symbol,
        positionAmt: parseFloat(p.positionAmt),
        entryPrice: parseFloat(p.entryPrice),
        isLong: parseFloat(p.positionAmt) > 0,
        unRealizedProfit: parseFloat(p.unRealizedProfit),
        leverage: parseInt(p.leverage)
      }));
      
      res.json({ status: "success", positions });
    } catch (e) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });
`;

if (!code.includes('/api/binance/positions')) {
    code = code.replace('app.post("/api/suggest-trade"', positionRoute + '\n  app.post("/api/suggest-trade"');
}

fs.writeFileSync('server.ts', code);
