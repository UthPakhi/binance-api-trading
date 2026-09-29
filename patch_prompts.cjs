const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

// Fix AI-signals background prompt
const oldBackground = "CRITICAL EXIT PERCENTAGES: You MUST set tp1Pct, tp2Pct, and tp3Pct to integers (e.g. 50, 30, 20 or 60, 25, 15) so that they sum EXACTLY to 100.`";
const newBackground = "CRITICAL EXIT PERCENTAGES (POSITION SIZING): tp1Pct, tp2Pct, and tp3Pct represent the PERCENTAGE OF POSITION SIZE to sell at each target, NOT the price difference. For example, if you want to sell half the position at TP1, set tp1Pct to 50. They MUST be integers (e.g. 50, 30, 20) and sum EXACTLY to 100.`";
code = code.replace(oldBackground, newBackground);

// Fix suggest-trade pass 2 prompt
const oldSuggest = "5. EXIT STRATEGY PERCENTAGES: Set tp1Pct, tp2Pct, and tp3Pct to integers so that they sum EXACTLY to 100 (e.g. 50, 30, 20 or 60, 25, 15).";
const newSuggest = "5. EXIT STRATEGY PERCENTAGES (POSITION SIZING): tp1Pct, tp2Pct, and tp3Pct represent the PERCENTAGE OF POSITION SIZE to sell at each target, NOT the price difference percentage. For example, to sell half the position at TP1, set tp1Pct to 50. They MUST be integers (e.g. 50, 30, 20) and sum EXACTLY to 100.";
code = code.replace(oldSuggest, newSuggest);

// Fix suggest-trade normalizer
const target = `const auditedTrade = JSON.parse(auditedText.trim());
      res.json({ status: "success", tradeSetup: auditedTrade });`;
const replacement = `const auditedTrade = JSON.parse(auditedText.trim());
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
code = code.replace(target, replacement);

fs.writeFileSync('server.ts', code);
console.log("Patched server.ts prompts and normalizer");
