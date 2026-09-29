const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');
code = code.replace(
  /if \(\!tradesRes\.ok\) \{\n\s*throw new Error\("Failed to fetch myTrades from Binance\."\);\n\s*\}/g,
  `if (!tradesRes.ok) {
        const errorText = await tradesRes.text();
        console.error("Binance myTrades error:", errorText);
        throw new Error("Failed to fetch myTrades from Binance: " + errorText);
      }`
);
fs.writeFileSync('server.ts', code);
