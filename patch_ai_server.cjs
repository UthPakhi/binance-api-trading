const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const oldPromptBlock = `
    const prompt = \\\`
You are an institutional quantitative trading AI. Analyze the current market context and generate 3 high-probability trade setups (1 Scalp, 1 Day Trade, 1 Swing Trade).
Use these context metrics:
BTC: \\\${JSON.stringify(btcContext)}
ETH: \\\${JSON.stringify(ethContext)}
SOL: \\\${JSON.stringify(solContext)}

Identify 3 distinct trading opportunities (you can choose BTC, ETH, SOL or any major high-liquidity altcoin).
Calculate realistic Risk/Reward. Be highly precise with prices.
\\\`
`.trim();

const newPromptBlock = `
    // Fetch live prices explicitly to anchor the AI
    let livePricesText = "";
    try {
      const pRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT","SOLUSDT"]');
      const pData = await pRes.json();
      livePricesText = pData.map((d: any) => \`\${d.symbol}: \$\${d.price}\`).join(", ");
    } catch(e) {
      livePricesText = "Unavailable";
    }

    const prompt = \`
You are an institutional quantitative trading AI. Analyze the current market context and generate 3 high-probability trade setups (1 Scalp, 1 Day Trade, 1 Swing Trade).

CRITICAL: Here are the EXACT CURRENT LIVE PRICES: \${livePricesText}
Your proposed ENTRY prices MUST be extremely close (within 0.5%) to these current live prices. DO NOT hallucinate prices from years ago. If you suggest a trade for BTC, ETH, or SOL, anchor your entry perfectly to the live price provided.

Use these structural context metrics:
BTC: \${JSON.stringify(btcContext)}
ETH: \${JSON.stringify(ethContext)}
SOL: \${JSON.stringify(solContext)}

Identify 3 distinct trading opportunities (prefer BTC, ETH, and SOL).
Calculate realistic Risk/Reward. Be highly precise with prices based on current live data.
\`
`.trim();

code = code.replace(oldPromptBlock, newPromptBlock);
fs.writeFileSync('server.ts', code);
console.log("Patched server.ts AI prices");
