const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const target = "      const pricesRes = await fetch('https://api.binance.com/api/v3/ticker/price');\n      const pricesData: any = await pricesRes.json();\n      const priceMap = new Map<string, number>(pricesData.map((p: any) => [p.symbol as string, parseFloat(p.price) as number]));";

const replace = `      const pricesRes = await fetch('https://api.binance.com/api/v3/ticker/price');
      let priceMap = new Map<string, number>();
      if (pricesRes.ok) {
        const pricesData: any = await pricesRes.json();
        if (Array.isArray(pricesData)) {
          priceMap = new Map<string, number>(pricesData.map((p: any) => [p.symbol as string, parseFloat(p.price) as number]));
        }
      }`;

code = code.replace(target, replace);
fs.writeFileSync('server.ts', code);
