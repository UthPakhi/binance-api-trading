const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const targetStr = `return res.json({ status: "success", signals: parsedData, generatedAt: now });`;
const replacement = `
      // Normalize percentages to sum to 100
      parsedData.forEach(sig => {
        const total = (sig.tp1Pct || 0) + (sig.tp2Pct || 0) + (sig.tp3Pct || 0);
        if (total > 0 && total !== 100) {
          sig.tp1Pct = Math.round(((sig.tp1Pct || 0) / total) * 100);
          sig.tp2Pct = Math.round(((sig.tp2Pct || 0) / total) * 100);
          sig.tp3Pct = 100 - sig.tp1Pct - sig.tp2Pct; // Ensure exactly 100
        } else if (total === 0) {
          sig.tp1Pct = 100;
          sig.tp2Pct = 0;
          sig.tp3Pct = 0;
        }
      });
      return res.json({ status: "success", signals: parsedData, generatedAt: now });
`;

code = code.replace(targetStr, replacement);
fs.writeFileSync('server.ts', code);
console.log("Patched server.ts with normalization");
