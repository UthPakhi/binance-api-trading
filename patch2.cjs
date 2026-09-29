const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const anchor = 'const solContext = await analyzePriceAction(\'SOLUSDT\');';

const newLogic = `
    const solContext = await analyzePriceAction('SOLUSDT');
    
    let livePricesText = "";
    try {
      const pRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22,%22SOLUSDT%22%5D');
      const pData = await pRes.json();
      livePricesText = pData.map((d) => d.symbol + ": $" + d.price).join(", ");
    } catch(e) {
      livePricesText = "Unavailable";
    }
`;

code = code.replace(anchor, newLogic);

const oldPrompt = 'Identify 3 distinct trading opportunities (you can choose BTC, ETH, SOL or any major high-liquidity altcoin).';
const newPrompt = 'CRITICAL: EXACT CURRENT LIVE PRICES: ${livePricesText}\\nYour proposed ENTRY prices MUST be within 0.5% of these current live prices. DO NOT hallucinate prices from years ago.\\n\\nIdentify 3 distinct trading opportunities (prefer BTC, ETH, SOL).';

code = code.replace(oldPrompt, newPrompt);

fs.writeFileSync('server.ts', code);
