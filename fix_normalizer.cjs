const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const target = `    cachedSignals = data.signals;`;
const replacement = `    // Normalize percentages to sum to 100 before caching
    data.signals.forEach(sig => {
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
    cachedSignals = data.signals;`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('server.ts', code);
  console.log("Successfully applied normalizer");
} else {
  console.log("Target not found");
}
