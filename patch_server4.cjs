const fs = require('fs');
const crypto = require('crypto');
let code = fs.readFileSync('server.ts', 'utf-8');

const positionRouteOld = `  app.get("/api/binance/positions", async (req, res) => {
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
  });`;

const positionRouteNew = `  app.get("/api/binance/positions", async (req, res) => {
    try {
      const apiKey = process.env.BINANCE_API_KEY;
      const apiSecret = process.env.BINANCE_API_SECRET;
      
      if (!apiKey || !apiSecret) {
        return res.status(400).json({ status: "error", message: "Binance API keys are missing in the environment." });
      }

      const timestamp = Date.now();
      const queryString = \`timestamp=\${timestamp}\`;
      const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
      
      // Fetch Spot Balances
      const accountRes = await fetch(\`https://api.binance.com/api/v3/account?\${queryString}&signature=\${signature}\`, {
        headers: { 'X-MBX-APIKEY': apiKey }
      });
      
      if (!accountRes.ok) {
        throw new Error("Failed to fetch account balances from Binance.");
      }
      
      const accountData = await accountRes.json();
      
      // Filter out empty balances and stablecoins
      const activeAssets = accountData.balances.filter((b: any) => {
        const total = parseFloat(b.free) + parseFloat(b.locked);
        return total > 0 && !['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD'].includes(b.asset);
      });

      // Fetch current prices to estimate USD value and filter out dust
      const pricesRes = await fetch('https://api.binance.com/api/v3/ticker/price');
      const pricesData = await pricesRes.json();
      const priceMap = new Map(pricesData.map((p: any) => [p.symbol, parseFloat(p.price)]));

      const positions = [];
      
      for (const asset of activeAssets) {
         const symbol = \`\${asset.asset}USDT\`;
         const totalAmt = parseFloat(asset.free) + parseFloat(asset.locked);
         const currentPrice = priceMap.get(symbol) || 0;
         
         const usdValue = totalAmt * currentPrice;
         
         // Filter out dust less than $5
         if (usdValue > 5) {
            let entryPrice = currentPrice; 
            try {
               const ts = Date.now();
               const qs = \`symbol=\${symbol}&limit=20&timestamp=\${ts}\`;
               const sig = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');
               const tradesRes = await fetch(\`https://api.binance.com/api/v3/myTrades?\${qs}&signature=\${sig}\`, {
                  headers: { 'X-MBX-APIKEY': apiKey }
               });
               if (tradesRes.ok) {
                  const trades = await tradesRes.json();
                  const buyTrades = trades.filter((t: any) => t.isBuyer);
                  if (buyTrades.length > 0) {
                     entryPrice = parseFloat(buyTrades[buyTrades.length - 1].price);
                  }
               }
            } catch (e) {
               console.warn(\`Could not fetch trades for \${symbol}\`);
            }

            positions.push({
               symbol: symbol,
               positionAmt: totalAmt,
               entryPrice: entryPrice,
               isLong: true,
               unRealizedProfit: (currentPrice - entryPrice) * totalAmt,
               leverage: 1, // Spot is 1x
               currentPrice: currentPrice,
               usdValue: usdValue
            });
         }
      }
      
      res.json({ status: "success", positions });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });`;

code = code.replace(positionRouteOld, positionRouteNew);
fs.writeFileSync('server.ts', code);
