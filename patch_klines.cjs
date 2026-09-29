const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const oldLines = `    const ethContext = await analyzePriceAction('ETHUSDT');
    
    const solContext = await analyzePriceAction('SOLUSDT');`;

const newLines = `    const ethKlinesRes = await fetch('https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=15m&limit=20');
    const ethKlines = ethKlinesRes.ok ? await ethKlinesRes.json() : [];
    const ethContext = analyzePriceAction(ethKlines);
    
    const solKlinesRes = await fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=15m&limit=20');
    const solKlines = solKlinesRes.ok ? await solKlinesRes.json() : [];
    const solContext = analyzePriceAction(solKlines);`;

code = code.replace(oldLines, newLines);
fs.writeFileSync('server.ts', code);
console.log("Patched server.ts kline fetching");
