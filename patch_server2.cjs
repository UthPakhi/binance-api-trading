const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const binanceRouteOld = `      const response = await fetch(\`https://api.binance.com/api/v3/account?\${queryString}&signature=\${signature}\`, {
        headers: {
          'X-MBX-APIKEY': apiKey
        }
      });
      
      if (!response.ok) {
        const errorData = await response.text();
        console.error("Binance API error:", errorData);
        throw new Error("Failed to fetch balance from Binance.");
      }
      
      const data = await response.json();
      const usdtBalance = data.balances.find((b: any) => b.asset === 'USDT');
      const usdtTotal = usdtBalance ? (parseFloat(usdtBalance.free) + parseFloat(usdtBalance.locked)) : 0;
      
      res.json({ status: "success", balance: usdtTotal });`;

const binanceRouteNew = `      const [spotRes, futRes] = await Promise.all([
        fetch(\`https://api.binance.com/api/v3/account?\${queryString}&signature=\${signature}\`, { headers: { 'X-MBX-APIKEY': apiKey } }),
        fetch(\`https://fapi.binance.com/fapi/v2/balance?\${queryString}&signature=\${signature}\`, { headers: { 'X-MBX-APIKEY': apiKey } })
      ]);
      
      if (!spotRes.ok) {
        const errorData = await spotRes.text();
        console.error("Binance Spot API error:", errorData);
        throw new Error("Failed to fetch Spot balance.");
      }
      
      const spotData = await spotRes.json();
      const spotUsdt = spotData.balances.find((b: any) => b.asset === 'USDT');
      const spotTotal = spotUsdt ? (parseFloat(spotUsdt.free) + parseFloat(spotUsdt.locked)) : 0;
      
      let futTotal = 0;
      if (futRes.ok) {
        const futData = await futRes.json();
        const futUsdt = futData.find((b: any) => b.asset === 'USDT');
        if (futUsdt) {
           futTotal = parseFloat(futUsdt.balance);
        }
      } else {
        console.warn("Could not fetch Futures balance, maybe not enabled.");
      }
      
      res.json({ status: "success", balance: spotTotal + futTotal, spotTotal, futTotal });`;

code = code.replace(binanceRouteOld, binanceRouteNew);
fs.writeFileSync('server.ts', code);
