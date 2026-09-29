const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const target = `      const auditedTrade = JSON.parse(auditedText.trim());

      res.json({ status: "success", tradeSetup: auditedTrade });`;

const replacement = `      const auditedTrade = JSON.parse(auditedText.trim());
      const total = (auditedTrade.tp1Pct || 0) + (auditedTrade.tp2Pct || 0) + (auditedTrade.tp3Pct || 0);
      if (total > 0 && total !== 100) {
        auditedTrade.tp1Pct = Math.round(((auditedTrade.tp1Pct || 0) / total) * 100);
        auditedTrade.tp2Pct = Math.round(((auditedTrade.tp2Pct || 0) / total) * 100);
        auditedTrade.tp3Pct = 100 - auditedTrade.tp1Pct - auditedTrade.tp2Pct;
      } else if (total === 0) {
        auditedTrade.tp1Pct = 100;
        auditedTrade.tp2Pct = 0;
        auditedTrade.tp3Pct = 0;
      }
      res.json({ status: "success", tradeSetup: auditedTrade });`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('server.ts', code);
  console.log("Applied suggest normalizer");
} else {
  console.log("Could not find suggest normalizer target");
}
