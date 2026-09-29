const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const backgroundTarget = `    // Normalize percentages to sum to 100 before caching
    data.signals.forEach(sig => {`;
const backgroundReplacement = `    // Mathematical RR enforcement and normalize percentages to sum to 100
    data.signals = data.signals.filter(sig => {
      if (!sig.isLong || sig.tp1 <= sig.entry || sig.sl >= sig.entry) return false;
      const risk = sig.entry - sig.sl;
      const reward = sig.tp1 - sig.entry;
      if (risk <= 0) return false;
      const rr = reward / risk;
      if (rr < 1) {
        sig.tp1 = parseFloat((sig.entry + (risk * 1.5)).toFixed(5));
        if (sig.tp2 && sig.tp2 < sig.tp1) sig.tp2 = parseFloat((sig.tp1 * 1.01).toFixed(5));
        if (sig.tp3 && sig.tp3 < sig.tp2) sig.tp3 = parseFloat((sig.tp2 * 1.01).toFixed(5));
      }
      return true;
    });
    
    data.signals.forEach(sig => {`;

code = code.replace(backgroundTarget, backgroundReplacement);


const manualTarget = `      const auditedTrade = JSON.parse(auditedText.trim());
      const total = (auditedTrade.tp1Pct || 0) + (auditedTrade.tp2Pct || 0) + (auditedTrade.tp3Pct || 0);`;

const manualReplacement = `      const auditedTrade = JSON.parse(auditedText.trim());
      
      if (auditedTrade.tradeFound) {
        if (auditedTrade.tp1 <= auditedTrade.entry || auditedTrade.sl >= auditedTrade.entry) {
          auditedTrade.tradeFound = false;
          auditedTrade.notes = "Trade rejected: Invalid structural logic.";
        } else {
          const risk = auditedTrade.entry - auditedTrade.sl;
          const reward = auditedTrade.tp1 - auditedTrade.entry;
          if (risk > 0) {
            const rr = reward / risk;
            if (rr < 1.0) {
              auditedTrade.tp1 = parseFloat((auditedTrade.entry + (risk * 1.5)).toFixed(5));
              if (auditedTrade.tp2 && auditedTrade.tp2 < auditedTrade.tp1) auditedTrade.tp2 = parseFloat((auditedTrade.tp1 * 1.01).toFixed(5));
              if (auditedTrade.tp3 && auditedTrade.tp3 < auditedTrade.tp2) auditedTrade.tp3 = parseFloat((auditedTrade.tp2 * 1.01).toFixed(5));
            }
          }
        }
      }
      
      const total = (auditedTrade.tp1Pct || 0) + (auditedTrade.tp2Pct || 0) + (auditedTrade.tp3Pct || 0);`;

code = code.replace(manualTarget, manualReplacement);

fs.writeFileSync('server.ts', code);
console.log("Applied programmatic RR enforcement!");
